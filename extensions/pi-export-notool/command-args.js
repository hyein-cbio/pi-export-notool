/** Parse /export-notool arguments while preserving spaces in the output path. */
export function parseExportArguments(args) {
  const trimmed = args.trim();
  const publishMatch = trimmed.match(/^--publish(?:\s+([\s\S]*))?$/);
  return publishMatch
    ? { publish: true, requestedPath: publishMatch[1]?.trim() ?? "" }
    : { publish: false, requestedPath: trimmed };
}
