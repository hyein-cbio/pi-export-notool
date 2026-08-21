import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createExportNoToolHandler } from "../extensions/pi-export-notool/export-command.js";
import { extractSessionData } from "../extensions/pi-export-notool/publish-export.js";

function sourceExportHtml() {
  const data = {
    header: {
      type: "session",
      version: 3,
      id: "command-test",
      timestamp: "2026-04-01T00:00:00.000Z",
      cwd: "/Users/alice/private-project",
    },
    entries: [
      {
        type: "message",
        id: "user",
        parentId: null,
        message: { role: "user", content: "Visible path: /Users/alice/private/file.txt" },
      },
      {
        type: "message",
        id: "assistant",
        parentId: "user",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "COMMAND_THINKING_SECRET" },
            { type: "toolCall", id: "call", name: "read", arguments: { path: "COMMAND_TOOL_ARG" } },
          ],
          stopReason: "toolUse",
        },
      },
      {
        type: "message",
        id: "result",
        parentId: "assistant",
        message: {
          role: "toolResult",
          toolCallId: "call",
          toolName: "read",
          content: [{ type: "text", text: "COMMAND_TOOL_RESULT" }],
        },
      },
    ],
    leafId: "result",
  };
  const encoded = Buffer.from(JSON.stringify(data), "utf8").toString("base64");
  return `<html><head><style></style></head><body><script id="session-data" type="application/json">${encoded}</script></body></html>`;
}

function commandHarness(sourceHtml) {
  let temporaryOutput;
  const notifications = [];
  const pi = {
    async exec(_command, args) {
      temporaryOutput = args.at(-1);
      await writeFile(temporaryOutput, sourceHtml, "utf8");
      return { code: 0, killed: false, stdout: "", stderr: "" };
    },
  };

  return {
    handler: createExportNoToolHandler(pi),
    notifications,
    getTemporaryOutput: () => temporaryOutput,
  };
}

function contextFor(directory, notifications, overrides = {}) {
  return {
    cwd: directory,
    hasUI: true,
    sessionManager: { getSessionFile: () => join(directory, "session.jsonl") },
    ui: {
      notify(message, level) {
        notifications.push({ message, level });
      },
      async confirm() {
        return true;
      },
    },
    ...overrides,
  };
}

async function assertTemporaryExportRemoved(path) {
  assert.ok(path, "Pi export path should be captured");
  await assert.rejects(access(dirname(path)), { code: "ENOENT" });
}

test("publish warning cancellation leaves the destination unchanged and removes the temporary export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-export-command-test-"));
  try {
    const output = join(directory, "published.html");
    await writeFile(output, "existing file", "utf8");
    const harness = commandHarness(sourceExportHtml());
    let warning;
    const ctx = contextFor(directory, harness.notifications);
    ctx.ui.confirm = async (title, message) => {
      warning = { title, message };
      return false;
    };

    await harness.handler(`--publish ${output}`, ctx);

    assert.equal(await readFile(output, "utf8"), "existing file");
    assert.equal(warning.title, "Sensitive information detected");
    assert.match(warning.message, /Absolute POSIX path/);
    assert.doesNotMatch(warning.message, /\/Users\/alice/);
    assert.ok(harness.notifications.some(({ message }) => message.includes("cancelled")));
    await assertTemporaryExportRemoved(harness.getTemporaryOutput());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("publish fails closed without confirmation UI and writes no destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-export-command-test-"));
  try {
    const output = join(directory, "published.html");
    const harness = commandHarness(sourceExportHtml());
    const ctx = contextFor(directory, harness.notifications, { hasUI: false });
    ctx.ui.confirm = async () => {
      throw new Error("confirm should not be called without UI");
    };

    await harness.handler(`--publish ${output}`, ctx);

    await assert.rejects(access(output), { code: "ENOENT" });
    assert.ok(harness.notifications.some(
      ({ message, level }) => level === "error" && message.includes("cannot request confirmation"),
    ));
    await assertTemporaryExportRemoved(harness.getTemporaryOutput());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("confirmed publish writes only sanitized session data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-export-command-test-"));
  try {
    const output = join(directory, "published.html");
    const harness = commandHarness(sourceExportHtml());
    const ctx = contextFor(directory, harness.notifications);

    await harness.handler(`--publish ${output}`, ctx);

    const html = await readFile(output, "utf8");
    const data = extractSessionData(html);
    const serialized = JSON.stringify(data);
    assert.match(html, /pi-export-notool: start/);
    assert.equal(serialized.includes("COMMAND_THINKING_SECRET"), false);
    assert.equal(serialized.includes("COMMAND_TOOL_ARG"), false);
    assert.equal(serialized.includes("COMMAND_TOOL_RESULT"), false);
    assert.equal(serialized.includes("Visible path"), true);
    assert.ok(harness.notifications.some(({ message }) => message.includes("Publish HTML export written")));
    await assertTemporaryExportRemoved(harness.getTemporaryOutput());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
