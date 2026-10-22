import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPORT_TIMEOUT_MS = 60_000;
const runnerPath = fileURLToPath(new URL("./native-export-runner.mjs", import.meta.url));

/**
 * Snapshot the actual theme, including resolved terminal defaults for system.
 * The saved theme setting/name alone cannot reproduce a live terminal palette.
 */
async function snapshotTheme(ctx, colorToHex) {
  const theme = ctx.ui.theme;
  const sourcePath = theme.sourcePath
    ?? ctx.ui.getAllThemes().find(({ name }) => name === theme.name)?.path;
  const resolvedColors = theme.colors;
  const snapshotColors = resolvedColors && colorToHex
    ? Object.fromEntries(Object.entries(resolvedColors).map(([key, value]) => [key, colorToHex(value)]))
    : undefined;
  const source = sourcePath
    ? JSON.parse((await readFile(sourcePath, "utf8")).replace(/^\uFEFF/, ""))
    : {};
  // Older Pi themes do not expose resolved Color objects; use their source JSON.
  const colors = snapshotColors ?? source.colors;
  if (!colors) throw new Error("The active Pi theme cannot be exported by this Pi version.");

  return {
    ...source,
    // Never use system/dark/light: Pi gives those built-in names special treatment.
    name: "pi-export-notool-snapshot",
    colors,
  };
}

/** Use the running Pi installation's exporter, not a different Pi from PATH. */
export function createNativeExporter(pi, packageDir, colorToHex) {
  return async (ctx, outputPath) => {
    // Capture before spawning or waiting: settings/terminal appearance may change.
    const sessionFile = ctx.sessionManager.getSessionFile();
    const snapshot = await snapshotTheme(ctx, colorToHex);
    const directory = await mkdtemp(join(tmpdir(), "pi-export-notool-theme-"));
    try {
      const themePath = join(directory, "theme.json");
      await writeFile(themePath, JSON.stringify(snapshot), { encoding: "utf8", mode: 0o600 });
      // Isolate temporary theme registration from the user's running Pi instance.
      const result = await pi.exec(
        process.execPath,
        [runnerPath, packageDir, themePath, sessionFile, outputPath],
        { cwd: ctx.cwd, timeout: EXPORT_TIMEOUT_MS },
      );
      if (result.killed || result.code !== 0) {
        throw new Error(result.stderr?.trim() || result.stdout?.trim() || "Pi HTML export failed.");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
