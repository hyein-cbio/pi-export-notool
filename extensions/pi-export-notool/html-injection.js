const START_MARKER = "/* pi-export-notool: start */";
const END_MARKER = "/* pi-export-notool: end */";

export const HIDE_TOOL_BLOCKS_CSS = `${START_MARKER}
/* Keep the transcript readable while retaining Pi's original session data. */
.tool-execution {
  display: none !important;
}
${END_MARKER}`;

/**
 * Add the no-tool stylesheet to a Pi HTML export.
 * The marker makes repeated exports or retries idempotent.
 */
export function injectNoToolCss(html) {
  if (html.includes(START_MARKER)) return html;

  const stylesheetClose = /<\/style\s*>/i;
  if (stylesheetClose.test(html)) {
    return html.replace(stylesheetClose, `\n${HIDE_TOOL_BLOCKS_CSS}\n</style>`);
  }

  const headClose = /<\/head\s*>/i;
  if (headClose.test(html)) {
    return html.replace(headClose, `<style>\n${HIDE_TOOL_BLOCKS_CSS}\n</style>\n</head>`);
  }

  throw new Error("The exported file does not contain a <style> or <head> element.");
}
