import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function runProbe(body) {
  const source = `
    import { registerHooks } from "node:module";
    const loaded = [];
    registerHooks({
      load(url, context, nextLoad) {
        loaded.push(url);
        return nextLoad(url, context);
      },
    });
    ${body}
    const hit = (pattern) => loaded.some((url) => pattern.test(url));
    console.log("REPORT " + JSON.stringify({
      publishExport: hit(/\\/publish-export\\.js$/),
      sensitiveInfo: hit(/\\/sensitive-info\\.js$/),
      secretScan: hit(/secret-scan/),
    }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.split("\n").find((entry) => entry.startsWith("REPORT "));
  assert.ok(line, `missing module report in stdout:\n${result.stdout}`);
  return JSON.parse(line.slice("REPORT ".length));
}

const handlerSetup = `
  import { mkdtemp, rm, writeFile } from "node:fs/promises";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { createExportNoToolHandler } from "./extensions/pi-export-notool/export-command.js";

  const directory = await mkdtemp(join(tmpdir(), "pi-export-notool-lazy-"));
  const output = join(directory, "out.html");
  const sourceHtml = "<html><head><style></style></head><body><script id=\\"session-data\\" type=\\"application/json\\">eyJoZWFkZXIiOnsidHlwZSI6InNlc3Npb24iLCJ2ZXJzaW9uIjozLCJpZCI6IngiLCJ0aW1lc3RhbXAiOiIyMDI2LTA0LTAxVDAwOjAwOjAwLjAwMFoifSwiZW50cmllcyI6W10sImxlYWZJZCI6bnVsbH0=</script></body></html>";
  const pi = {
    async exec(_command, args) {
      await writeFile(args.at(-1), sourceHtml, "utf8");
      return { code: 0, killed: false, stdout: "", stderr: "" };
    },
  };
  const ctx = {
    cwd: directory,
    hasUI: true,
    sessionManager: { getSessionFile: () => join(directory, "session.jsonl") },
    ui: { notify() {}, async confirm() { return true; } },
  };
  try {
    await createExportNoToolHandler(pi)(COMMAND_ARGS, ctx);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
`;

test("importing the command handler does not load publish or secret-scan modules", () => {
  assert.deepEqual(
    runProbe(`await import("./extensions/pi-export-notool/export-command.js");`),
    { publishExport: false, sensitiveInfo: false, secretScan: false },
  );
});

test("default export does not load publish or secret-scan modules", () => {
  assert.deepEqual(
    runProbe(handlerSetup.replace("COMMAND_ARGS", "output")),
    { publishExport: false, sensitiveInfo: false, secretScan: false },
  );
});

test("publish export loads sanitizer and secret-scan on demand", () => {
  assert.deepEqual(
    runProbe(handlerSetup.replace("COMMAND_ARGS", "`--publish ${output}`")),
    { publishExport: true, sensitiveInfo: true, secretScan: true },
  );
});
