import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseExportArguments } from "./command-args.js";
import { injectNoToolCss } from "./html-injection.js";

const EXPORT_TIMEOUT_MS = 60_000;

function outputPathFor(options, cwd, sessionFile) {
  const sessionId = basename(sessionFile, ".jsonl");
  const defaultName = options.publish
    ? `pi-no-tools-publish-${sessionId}.html`
    : `pi-no-tools-${sessionId}.html`;
  const outputPath = resolve(cwd, options.requestedPath || defaultName);

  if (extname(outputPath).toLowerCase() !== ".html") {
    throw new Error("Output path must use the .html extension.");
  }

  return outputPath;
}

async function runPiExport(pi, sessionFile, outputPath, cwd) {
  // Use Pi's own exporter so the output keeps the installed export template and theme.
  const result = await pi.exec(
    "pi",
    ["--no-extensions", "--export", sessionFile, outputPath],
    { cwd, timeout: EXPORT_TIMEOUT_MS },
  );
  if (result.killed || result.code !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    throw new Error(stderr || stdout || "Pi HTML export failed.");
  }
}

async function loadPublishModules() {
  // Keep sanitizer + secret-scan off the startup graph; they are publish-only.
  const [{ createPublishHtml }, { findSensitiveInfo, formatSensitiveWarning }] = await Promise.all([
    import("./publish-export.js"),
    import("./sensitive-info.js"),
  ]);
  return { createPublishHtml, findSensitiveInfo, formatSensitiveWarning };
}

async function writePublishExport(pi, ctx, sessionFile, outputPath) {
  const { createPublishHtml, findSensitiveInfo, formatSensitiveWarning } = await loadPublishModules();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-export-notool-"));
  const temporaryOutput = join(temporaryDirectory, "export.html");

  let published;
  try {
    // Never place Pi's unsanitized export at the requested publish path, even briefly.
    await runPiExport(pi, sessionFile, temporaryOutput, ctx.cwd);
    const sourceHtml = await readFile(temporaryOutput, "utf8");
    published = createPublishHtml(sourceHtml);
  } finally {
    // Delete the unsanitized file before prompting or writing the requested output.
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const findings = findSensitiveInfo(published.sessionData);
  if (findings.length > 0) {
    if (!ctx.hasUI) {
      throw new Error(
        `Publish export found ${findings.length} potential sensitive item(s), but this mode cannot request confirmation.`,
      );
    }

    const confirmed = await ctx.ui.confirm(
      "Sensitive information detected",
      formatSensitiveWarning(findings),
    );
    if (!confirmed) {
      ctx.ui.notify("Publish export cancelled; no file was written.", "info");
      return undefined;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, injectNoToolCss(published.html), "utf8");

  return {
    removedItems: Object.values(published.stats).reduce((total, count) => total + count, 0),
    sensitiveItems: findings.length,
  };
}

/** Create the /export-notool handler. Exported separately for command-level tests. */
export function createExportNoToolHandler(pi) {
  return async (args, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      ctx.ui.notify("No saved session is available to export yet.", "error");
      return;
    }

    try {
      const options = parseExportArguments(args);
      const outputPath = outputPathFor(options, ctx.cwd, sessionFile);

      if (options.publish) {
        const result = await writePublishExport(pi, ctx, sessionFile, outputPath);
        if (!result) return;

        const warningSuffix = result.sensitiveItems > 0
          ? ` after confirming ${result.sensitiveItems} sensitive finding(s)`
          : "";
        ctx.ui.notify(
          `Publish HTML export written to ${outputPath} (${result.removedItems} internal item(s) removed${warningSuffix})`,
          "info",
        );
        return;
      }

      await mkdir(dirname(outputPath), { recursive: true });
      await runPiExport(pi, sessionFile, outputPath, ctx.cwd);
      const html = await readFile(outputPath, "utf8");
      await writeFile(outputPath, injectNoToolCss(html), "utf8");
      ctx.ui.notify(`No-tool HTML export written to ${outputPath}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`No-tool export failed: ${message}`, "error");
    }
  };
}
