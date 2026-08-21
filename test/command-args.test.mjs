import assert from "node:assert/strict";
import test from "node:test";
import { parseExportArguments } from "../extensions/pi-export-notool/command-args.js";

test("parseExportArguments preserves the existing optional output path", () => {
  assert.deepEqual(parseExportArguments(""), { publish: false, requestedPath: "" });
  assert.deepEqual(parseExportArguments("reports/session export.html"), {
    publish: false,
    requestedPath: "reports/session export.html",
  });
});

test("parseExportArguments recognizes --publish before the optional path", () => {
  assert.deepEqual(parseExportArguments("--publish"), { publish: true, requestedPath: "" });
  assert.deepEqual(parseExportArguments(" --publish reports/public session.html "), {
    publish: true,
    requestedPath: "reports/public session.html",
  });
});
