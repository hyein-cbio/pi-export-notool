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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Show the same chat status `/export` shows via showStatus.
 * ctx.ui.notify(..., "info") is that handler. Re-emit on the next turn so a
 * chat rebuild at the end of the command cannot drop the only copy.
 */
function showExportStatus(ctx, message, level = "info") {
  const notify = ctx?.ui?.notify;
  if (typeof notify !== "function") {
    if (level === "error") console.error(message);
    else console.log(message);
    return;
  }

  notify.call(ctx.ui, message, level);
  if (level !== "info") return;

  const timer = setTimeout(() => {
    try {
      notify.call(ctx.ui, message, level);
    } catch {
      // The command already reported the status. A late chat rebuild must not crash.
    }
  }, 0);
  timer.unref?.();
}

async function injectNoToolCssFile(outputPath) {
  const html = await readFile(outputPath, "utf8");
  const injected = injectNoToolCss(html);
  if (injected !== html) {
    await writeFile(outputPath, injected, "utf8");
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
      showExportStatus(ctx, "Publish export cancelled; no file was written.", "info");
      return undefined;
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  // Write the sanitized file first. CSS injection must not be required for the status.
  await writeFile(outputPath, published.html, "utf8");

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
      showExportStatus(ctx, "No saved session is available to export yet.", "error");
      return;
    }

    try {
      const options = parseExportArguments(args);
      const outputPath = outputPathFor(options, ctx.cwd, sessionFile);

      if (options.publish) {
        const result = await writePublishExport(pi, ctx, sessionFile, outputPath);
        if (!result) return;
        await finishExport(ctx, outputPath, exportStatus(outputPath, result));
        return;
      }

      await mkdir(dirname(outputPath), { recursive: true });
      await runPiExport(pi, sessionFile, outputPath, ctx.cwd);
      await finishExport(ctx, outputPath, `Session exported to: ${outputPath}`);
    } catch (error) {
      showExportStatus(ctx, `No-tool export failed: ${errorMessage(error)}`, "error");
    }
  };
}

function exportStatus(outputPath, result) {
  const warningSuffix = result.sensitiveItems > 0
    ? ` after confirming ${result.sensitiveItems} sensitive finding(s)`
    : "";
  return `Session exported to: ${outputPath} (${result.removedItems} internal item(s) removed${warningSuffix})`;
}

/**
 * Always show the export status, whether or not no-tool CSS injection succeeds.
 * Injection is an extra display option and must not swallow the showStatus notify.
 */
async function finishExport(ctx, outputPath, message) {
  let injectionError;
  try {
    await injectNoToolCssFile(outputPath);
  } catch (error) {
    injectionError = error;
  }

  showExportStatus(ctx, message, "info");
  if (injectionError) {
    showExportStatus(
      ctx,
      `No-tool option injection failed: ${errorMessage(injectionError)}`,
      "error",
    );
  }
}
