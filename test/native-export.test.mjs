import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createExportNoToolHandler } from "../extensions/pi-export-notool/export-command.js";
import { injectNoToolCss } from "../extensions/pi-export-notool/html-injection.js";
import { createNativeExporter } from "../extensions/pi-export-notool/native-export.js";
import { createPublishHtml } from "../extensions/pi-export-notool/publish-export.js";

// Set PI_TEST_PACKAGE_DIR to exercise another installed Pi (e.g. the running CLI).
const packageDir = process.env.PI_TEST_PACKAGE_DIR
  ? resolve(process.env.PI_TEST_PACKAGE_DIR)
  : dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const internalUrl = (path) => pathToFileURL(join(packageDir, "dist", path)).href;
const themeApi = await import(internalUrl("modes/interactive/theme/theme.js"));
const { exportFromFile } = await import(internalUrl("core/export-html/index.js"));
const requireFromPi = createRequire(join(packageDir, "package.json"));
const { colorToHex } = await import(pathToFileURL(requireFromPi.resolve("@earendil-works/pi-tui")).href);
const execFileAsync = promisify(execFile);
const pi = {
  async exec(command, args, options) {
    try {
      const result = await execFileAsync(command, args, { ...options, encoding: "utf8" });
      return { ...result, code: 0, killed: false };
    } catch (error) {
      return { code: error.code, killed: error.killed, stdout: error.stdout, stderr: error.stderr };
    }
  },
};

async function sessionIn(directory) {
  const file = join(directory, "session.jsonl");
  const entries = [
    { type: "session", version: 3, id: "theme-test", timestamp: "2026-04-01T00:00:00.000Z", cwd: directory },
    { type: "message", id: "user", parentId: null, timestamp: "2026-04-01T00:00:00.000Z", message: { role: "user", content: "Hello", timestamp: 0 } },
  ];
  await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

// A snapshot may regroup foreground/background tokens; declaration order is immaterial.
function canonicalThemeHtml(html) {
  return html.replace(/:root \{([^}]+)\}/, (_block, declarations) =>
    ":root {" + declarations.split(";").map((line) => line.trim()).filter(Boolean).sort().join(";") + "}",
  );
}

const schemes = ["light", "dark", "custom", "system-light", "system-dark"];
for (const scheme of schemes) {
  for (const publish of [false, true]) {
    test(`${publish ? "publish" : "default"} export matches native Pi for ${scheme}`, async (t) => {
      if (scheme.startsWith("system-") && !themeApi.setTerminalColors) {
        t.skip("This Pi predates the system theme; run with PI_TEST_PACKAGE_DIR pointing to modern Pi.");
        return;
      }
      const directory = await mkdtemp(join(tmpdir(), "pi-export-theme test-"));
      try {
        const sessionFile = await sessionIn(directory);
        // Leave the default theme dark to detect reliance on saved/global state.
        themeApi.initTheme("dark", false);
        let themeName = scheme;
        if (scheme === "custom") {
          const source = JSON.parse(await readFile(join(packageDir, "dist/modes/interactive/theme/light.json"), "utf8"));
          source.name = "export-test-custom";
          source.vars = { ...source.vars, exportPaper: "#f8f0de" };
          source.export = { pageBg: "exportPaper", cardBg: "#fff8ee", infoBg: "#f0e0c0" };
          const path = join(directory, "custom.json");
          await writeFile(path, JSON.stringify(source));
          themeApi.setRegisteredThemes([themeApi.loadThemeFromPath(path)]);
          themeName = source.name;
        } else if (scheme.startsWith("system-")) {
          const light = scheme === "system-light";
          themeApi.setTerminalColors({
            foreground: light ? { r: 17, g: 34, b: 51 } : { r: 238, g: 221, b: 204 },
            background: light ? { r: 250, g: 248, b: 240 } : { r: 20, g: 25, b: 30 },
            palette: Array.from({ length: 16 }, (_, index) => ({
              r: (index * 47) % 256, g: (index * 83) % 256, b: (index * 131) % 256,
            })),
          });
          themeName = "system";
        }
        const activeTheme = themeApi.getThemeByName(themeName);
        assert.ok(activeTheme);
        const nativePath = join(directory, "native.html");
        await exportFromFile(sessionFile, { outputPath: nativePath, themeName });
        const nativeHtml = await readFile(nativePath, "utf8");
        const notifications = [];
        const ctx = {
          cwd: directory,
          hasUI: true,
          sessionManager: { getSessionFile: () => sessionFile },
          ui: {
            theme: activeTheme,
            getAllThemes: () => themeApi.getAvailableThemesWithPaths(),
            notify: (message, level) => notifications.push({ message, level }),
            confirm: async () => { throw new Error("No sensitive conversation should require confirmation"); },
          },
        };
        const outputPath = join(directory, "no tools.html");
        const handler = createExportNoToolHandler(createNativeExporter(pi, packageDir, colorToHex));
        await handler(`${publish ? "--publish " : ""}${outputPath}`, ctx);
        assert.equal(notifications.some(({ level }) => level === "error"), false, JSON.stringify(notifications));
        const html = await readFile(outputPath, "utf8");
        assert.equal(canonicalThemeHtml(html), canonicalThemeHtml(injectNoToolCss(publish ? createPublishHtml(nativeHtml).html : nativeHtml)));
        assert.ok(notifications.some(({ level }) => level === "info"));
        assert.equal(themeApi.theme.name, "dark", "Export must not change the running theme");
        if (scheme === "custom") assert.match(html, /--exportPageBg: #f8f0de;/);
      } finally {
        themeApi.setRegisteredThemes([]);
        themeApi.stopThemeWatcher();
        themeApi.setTerminalColors?.({});
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}

for (const outcome of ["success", "failure", "timeout", "spawn error"]) {
  test(`native exporter removes its theme snapshot after ${outcome}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-export-theme-cleanup-"));
    let themePath;
    try {
      const execPi = {
        async exec(command, args, options) {
          assert.equal(command, process.execPath);
          assert.equal(options.timeout, 60_000);
          assert.equal(args[1], packageDir);
          themePath = args[2];
          assert.match(await readFile(themePath, "utf8"), /pi-export-notool-snapshot/);
          if (outcome === "spawn error") throw new Error("spawn failure");
          return {
            code: outcome === "failure" ? 1 : 0,
            killed: outcome === "timeout",
            stdout: "",
            stderr: outcome === "failure" ? "export failure" : "",
          };
        },
      };
      const theme = themeApi.getThemeByName("light");
      const result = createNativeExporter(execPi, packageDir, colorToHex)({
        cwd: directory,
        sessionManager: { getSessionFile: () => join(directory, "session.jsonl") },
        ui: { theme, getAllThemes: () => themeApi.getAvailableThemesWithPaths() },
      }, join(directory, "out.html"));
      if (outcome === "success") await result;
      else await assert.rejects(result, /failure|Pi HTML export failed/);
      await assert.rejects(readFile(themePath), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("Pi extension loader registers a working theme-preserving command", async () => {
  const { loadExtensions } = await import(internalUrl("core/extensions/loader.js"));
  const extensionPath = fileURLToPath(new URL("../extensions/pi-export-notool/index.ts", import.meta.url));
  const loaded = await loadExtensions([extensionPath], process.cwd());
  assert.deepEqual(loaded.errors, []);
  const command = loaded.extensions[0].commands.get("export-notool");
  assert.ok(command);
  const directory = await mkdtemp(join(tmpdir(), "pi-export-loader-test-"));
  try {
    const sessionFile = await sessionIn(directory);
    const notifications = [];
    const outputPath = join(directory, "light.html");
    await command.handler(outputPath, {
      cwd: directory,
      hasUI: true,
      sessionManager: { getSessionFile: () => sessionFile },
      ui: {
        theme: themeApi.getThemeByName("light"),
        getAllThemes: () => themeApi.getAvailableThemesWithPaths(),
        notify: (message, level) => notifications.push({ message, level }),
      },
    });
    assert.equal(notifications.some(({ level }) => level === "error"), false, JSON.stringify(notifications));
    const nativePath = join(directory, "native.html");
    await exportFromFile(sessionFile, { outputPath: nativePath, themeName: "light" });
    assert.equal(
      canonicalThemeHtml(await readFile(outputPath, "utf8")),
      canonicalThemeHtml(injectNoToolCss(await readFile(nativePath, "utf8"))),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
