import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import {
  createPublishHtml,
  extractSessionData,
  sanitizeSessionData,
} from "../extensions/pi-export-notool/publish-export.js";

function htmlWithSessionData(sessionData) {
  const encoded = Buffer.from(JSON.stringify(sessionData), "utf8").toString("base64");
  return `<!doctype html><html><head><style></style></head><body><script id="session-data" type="application/json">${encoded}</script></body></html>`;
}

function sampleSessionData() {
  return {
    header: {
      type: "session",
      version: 3,
      id: "session-id",
      timestamp: "2026-04-01T00:00:00.000Z",
      cwd: "/Users/alice/secret-project",
      parentSession: "/Users/alice/.pi/session.jsonl",
    },
    entries: [
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-04-01T00:00:01.000Z",
        message: { role: "user", content: "Visible user content" },
      },
      {
        type: "message",
        id: "a-tools",
        parentId: "u1",
        timestamp: "2026-04-01T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "THINKING_SECRET" },
            { type: "toolCall", id: "call-1", name: "read", arguments: { path: "TOOL_ARG_SECRET" } },
          ],
          stopReason: "toolUse",
        },
      },
      {
        type: "message",
        id: "tr1",
        parentId: "a-tools",
        timestamp: "2026-04-01T00:00:03.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "TOOL_RESULT_SECRET" }],
          details: { hidden: "TOOL_DETAIL_SECRET" },
        },
      },
      {
        type: "message",
        id: "bash1",
        parentId: "tr1",
        timestamp: "2026-04-01T00:00:04.000Z",
        message: {
          role: "bashExecution",
          command: "BASH_COMMAND_SECRET",
          output: "BASH_OUTPUT_SECRET",
        },
      },
      {
        type: "message",
        id: "a2",
        parentId: "bash1",
        timestamp: "2026-04-01T00:00:05.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Visible assistant content" },
            { type: "thinking", thinking: "SECOND_THINKING_SECRET" },
            { type: "toolCall", id: "call-2", name: "bash", arguments: { command: "SECOND_TOOL_SECRET" } },
          ],
          provider: "example",
          model: "example-model",
          stopReason: "toolUse",
          usage: {
            input: 10,
            output: 5,
            cost: { input: 0.01, output: 0.02, unexpected: "USAGE_SECRET" },
          },
        },
      },
      {
        type: "message",
        id: "tr2",
        parentId: "a2",
        timestamp: "2026-04-01T00:00:06.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "bash",
          content: [{ type: "text", text: "SECOND_RESULT_SECRET" }],
        },
      },
      {
        type: "message",
        id: "a3",
        parentId: "tr2",
        timestamp: "2026-04-01T00:00:07.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Final visible answer" }],
          stopReason: "stop",
        },
      },
      {
        type: "custom_message",
        id: "hidden-custom",
        parentId: "a3",
        timestamp: "2026-04-01T00:00:08.000Z",
        customType: "hidden",
        content: "HIDDEN_CUSTOM_SECRET",
        display: false,
      },
      {
        type: "custom_message",
        id: "visible-custom",
        parentId: "hidden-custom",
        timestamp: "2026-04-01T00:00:09.000Z",
        customType: "visible",
        content: "Visible custom content",
        display: true,
        details: { hidden: "CUSTOM_DETAIL_SECRET" },
      },
      {
        type: "compaction",
        id: "compaction",
        parentId: "visible-custom",
        timestamp: "2026-04-01T00:00:10.000Z",
        summary: "Visible compaction summary",
        tokensBefore: 100,
        retainedTail: [
          { role: "toolResult", content: [{ type: "text", text: "RETAINED_TOOL_SECRET" }] },
          { role: "assistant", content: [{ type: "thinking", thinking: "RETAINED_THINKING_SECRET" }] },
        ],
        details: { readFiles: ["COMPACTION_DETAIL_SECRET"] },
      },
      {
        type: "future_private_entry",
        id: "opaque",
        parentId: "compaction",
        timestamp: "2026-04-01T00:00:11.000Z",
        data: "OPAQUE_SECRET",
      },
    ],
    leafId: "opaque",
    systemPrompt: "SYSTEM_PROMPT_SECRET",
    tools: [{ name: "read", description: "TOOL_SCHEMA_SECRET" }],
    renderedTools: { "call-1": { callHtml: "RENDERED_TOOL_SECRET" } },
  };
}

test("createPublishHtml physically removes internal content and repairs the session tree", () => {
  const result = createPublishHtml(htmlWithSessionData(sampleSessionData()));
  const published = extractSessionData(result.html);
  const serialized = JSON.stringify(published);

  for (const sentinel of [
    "THINKING_SECRET",
    "TOOL_ARG_SECRET",
    "TOOL_RESULT_SECRET",
    "TOOL_DETAIL_SECRET",
    "BASH_COMMAND_SECRET",
    "BASH_OUTPUT_SECRET",
    "SECOND_THINKING_SECRET",
    "SECOND_TOOL_SECRET",
    "SECOND_RESULT_SECRET",
    "USAGE_SECRET",
    "HIDDEN_CUSTOM_SECRET",
    "CUSTOM_DETAIL_SECRET",
    "RETAINED_TOOL_SECRET",
    "RETAINED_THINKING_SECRET",
    "COMPACTION_DETAIL_SECRET",
    "OPAQUE_SECRET",
    "SYSTEM_PROMPT_SECRET",
    "TOOL_SCHEMA_SECRET",
    "RENDERED_TOOL_SECRET",
    "/Users/alice/secret-project",
  ]) {
    assert.equal(serialized.includes(sentinel), false, `${sentinel} should be absent`);
  }

  assert.equal(serialized.includes("Visible user content"), true);
  assert.equal(serialized.includes("Visible assistant content"), true);
  assert.equal(serialized.includes("Final visible answer"), true);
  assert.equal(serialized.includes("Visible custom content"), true);
  assert.equal(serialized.includes("Visible compaction summary"), true);
  assert.deepEqual(Object.keys(published).sort(), ["entries", "header", "leafId"]);
  assert.deepEqual(Object.keys(published.header).sort(), ["id", "timestamp", "type", "version"]);

  const byId = new Map(published.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.has("a-tools"), false);
  assert.equal(byId.has("tr1"), false);
  assert.equal(byId.has("bash1"), false);
  assert.equal(byId.has("tr2"), false);
  assert.equal(byId.has("hidden-custom"), false);
  assert.equal(byId.has("opaque"), false);
  assert.equal(byId.get("a2").parentId, "u1");
  assert.equal(byId.get("a3").parentId, "a2");
  assert.equal(byId.get("visible-custom").parentId, "a3");
  assert.equal(byId.get("compaction").parentId, "visible-custom");
  assert.equal(published.leafId, "compaction");
  assert.deepEqual(byId.get("a2").message.content, [
    { type: "text", text: "Visible assistant content" },
  ]);
  assert.equal("retainedTail" in byId.get("compaction"), false);

  assert.equal(result.stats.removedToolCalls, 2);
  assert.equal(result.stats.removedToolResults, 2);
  assert.equal(result.stats.removedThinkingBlocks, 2);
  assert.equal(result.stats.removedBashExecutions, 1);
  assert.equal(result.stats.removedAssistantMessages, 1);
});

test("sanitizeSessionData omits malformed compactions and repairs their children", () => {
  const { sessionData } = sanitizeSessionData({
    header: { id: "session", timestamp: "2026-04-01T00:00:00.000Z" },
    entries: [
      { type: "message", id: "user", parentId: null, message: { role: "user", content: "hello" } },
      { type: "compaction", id: "broken", parentId: "user", summary: "missing token count" },
      {
        type: "message",
        id: "answer",
        parentId: "broken",
        message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop" },
      },
    ],
    leafId: "answer",
  });

  assert.deepEqual(sessionData.entries.map((entry) => entry.id), ["user", "answer"]);
  assert.equal(sessionData.entries[1].parentId, "user");
});

test("sanitizeSessionData fails closed for malformed or ambiguous data", () => {
  assert.throws(() => sanitizeSessionData({ header: {}, entries: "not-an-array" }), /entries array/);
  assert.throws(
    () => sanitizeSessionData({
      header: {},
      entries: [
        { type: "message", id: "duplicate", parentId: null, message: { role: "user", content: "a" } },
        { type: "message", id: "duplicate", parentId: null, message: { role: "user", content: "b" } },
      ],
    }),
    /Duplicate session entry id/,
  );
  assert.throws(
    () => sanitizeSessionData({
      header: {},
      entries: [
        { type: "message", id: "cycle-a", parentId: "cycle-b", message: { role: "user", content: "a" } },
        { type: "message", id: "cycle-b", parentId: "cycle-a", message: { role: "user", content: "b" } },
      ],
      leafId: "cycle-b",
    }),
    /Cycle in published session tree/,
  );
  assert.throws(() => createPublishHtml("<html><body>No session payload</body></html>"), /exactly one/);
});
