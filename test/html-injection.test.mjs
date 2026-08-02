import assert from "node:assert/strict";
import test from "node:test";
import { HIDE_TOOL_BLOCKS_CSS, injectNoToolCss } from "../extensions/pi-export-notool/html-injection.js";

test("injectNoToolCss adds CSS before an existing stylesheet closes", () => {
  const exported = "<html><head><style>.tool-execution { padding: 1rem; }</style></head><body></body></html>";
  const result = injectNoToolCss(exported);

  assert.match(
    result,
    /\.tool-execution,\s*\.thinking-block,\s*\.assistant-message:not\(:has\(\.assistant-text\)\):has\(\.thinking-block\),\s*\.assistant-message:not\(:has\(\.assistant-text\)\):has\(\.tool-execution\)\s*\{\s*display: none !important;/,
  );
  assert.doesNotMatch(result, /padding-(?:top|bottom): 4px/);
  assert.ok(result.indexOf(HIDE_TOOL_BLOCKS_CSS) < result.indexOf("</style>"));
  assert.equal((result.match(/pi-export-notool: start/g) ?? []).length, 1);
});

test("injectNoToolCss is idempotent", () => {
  const once = injectNoToolCss("<html><head><style></style></head></html>");
  const twice = injectNoToolCss(once);

  assert.equal(twice, once);
});

test("injectNoToolCss creates a stylesheet when the export has a head but no style", () => {
  const result = injectNoToolCss("<html><head><title>Session</title></head><body></body></html>");

  assert.match(result, /<style>\n\/\* pi-export-notool: start \*\//);
  assert.match(result, /<\/style>\n<\/head>/);
});
