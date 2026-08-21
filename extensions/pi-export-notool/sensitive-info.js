import { scan } from "@sanity-labs/secret-scan";

// Avoid URL pathnames by requiring a boundary that cannot be the host or URL scheme.
const POSIX_ABSOLUTE_PATH = /(^|[\s("'`=\[])((?:\/(?!\/)[^\s"'`<>/]+)+)/gm;
const WINDOWS_ABSOLUTE_PATH = /(^|[\s("'`=\[])(([A-Za-z]:[\\/])[^\\/\s"'`<>]+(?:[\\/][^\\/\s"'`<>]+)*)/gm;
const UNC_ABSOLUTE_PATH = /(^|[\s("'`=\[])(\\\\[^\\/\s"'`<>]+[\\/][^\\/\s"'`<>]+(?:[\\/][^\\/\s"'`<>]+)*)/gm;

const COMMON_POSIX_ROOTS = new Set([
  "Applications", "Library", "Users", "Volumes", "bin", "dev", "etc", "home", "mnt",
  "opt", "private", "proc", "root", "sbin", "srv", "sys", "tmp", "usr", "var", "workspace", "workspaces",
]);

function collectStrings(value, location, output) {
  if (typeof value === "string") {
    output.push({ value, location });
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${location}[${index}]`, output));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    // Image bytes are opaque, high-entropy data and are not meaningful text to scan.
    if (value.type === "image" && key === "data") continue;
    collectStrings(child, `${location}.${key}`, output);
  }
}

function isLikelyPosixPath(candidate) {
  const components = candidate.slice(1).split("/");
  if (components.length > 1) return true;

  const component = components[0];
  // One-segment slash commands are ambiguous. Still catch dotfiles, filenames,
  // and standard filesystem roots while leaving commands such as /export-notool alone.
  return component.startsWith(".") || component.includes(".") || COMMON_POSIX_ROOTS.has(component);
}

function findPaths(text, regex, label, location) {
  regex.lastIndex = 0;
  const findings = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const candidate = match[2].replace(/[),.;:!?]+$/, "");
    const shouldReport = label !== "Absolute POSIX path" || isLikelyPosixPath(candidate);
    if (candidate.length > 0 && shouldReport) {
      findings.push({
        kind: "absolute-path",
        label,
        confidence: "medium",
        location,
      });
    }
    if (match[0].length === 0) regex.lastIndex++;
  }
  return findings;
}

/**
 * Find likely credentials and absolute paths without returning matched values.
 * Secret patterns come from the MIT-licensed @sanity-labs/secret-scan package.
 */
export function findSensitiveInfo(value) {
  const strings = [];
  collectStrings(value, "$", strings);

  const findings = [];
  for (const item of strings) {
    for (const secret of scan(item.value)) {
      findings.push({
        kind: "secret",
        label: secret.label,
        confidence: secret.confidence,
        location: item.location,
      });
    }

    findings.push(...findPaths(item.value, POSIX_ABSOLUTE_PATH, "Absolute POSIX path", item.location));
    findings.push(...findPaths(item.value, WINDOWS_ABSOLUTE_PATH, "Absolute Windows path", item.location));
    findings.push(...findPaths(item.value, UNC_ABSOLUTE_PATH, "Absolute UNC path", item.location));
  }

  return findings;
}

/** Build a bounded warning for Pi's confirm dialog without echoing secret values. */
export function formatSensitiveWarning(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.label}\u0000${finding.confidence}`;
    const current = groups.get(key) ?? { label: finding.label, confidence: finding.confidence, count: 0 };
    current.count++;
    groups.set(key, current);
  }

  const grouped = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const visible = grouped.slice(0, 8);
  const lines = visible.map((group) => `• ${group.label} (${group.confidence}): ${group.count}`);
  if (grouped.length > visible.length) lines.push(`• ${grouped.length - visible.length} more finding type(s)`);

  return [
    `The published conversation still contains ${findings.length} potential sensitive item(s):`,
    "",
    ...lines,
    "",
    "Matched values are not shown. Continue writing the file?",
  ].join("\n");
}
