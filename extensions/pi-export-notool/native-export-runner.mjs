import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Pi's HTML exporter is not public API. Keep the version-sensitive imports here.
// No extensions, settings changes, model services, or terminal queries are needed.
const [packageDir, themePath, sessionFile, outputPath] = process.argv.slice(2);
const internalUrl = (path) => pathToFileURL(join(packageDir, "dist", path)).href;
const { loadThemeFromPath, setRegisteredThemes } = await import(internalUrl("modes/interactive/theme/theme.js"));
const { exportFromFile } = await import(internalUrl("core/export-html/index.js"));
const theme = loadThemeFromPath(themePath);
setRegisteredThemes([theme]);
await exportFromFile(sessionFile, { outputPath, themeName: theme.name });
