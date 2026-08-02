import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { basename, dirname, extname, resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { injectNoToolCss } from "./html-injection.js";

const EXPORT_TIMEOUT_MS = 60_000;

function outputPathFor(args: string, cwd: string, sessionFile: string): string {
  const requestedPath = args.trim();
  const defaultName = `pi-no-tools-${basename(sessionFile, ".jsonl")}.html`;
  const outputPath = resolve(cwd, requestedPath || defaultName);

  if (extname(outputPath).toLowerCase() !== ".html") {
    throw new Error("Output path must use the .html extension.");
  }

  return outputPath;
}

export default function (pi: ExtensionAPI) {
  const exportNoTool = async (args: string, ctx: ExtensionCommandContext) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No saved session is available to export yet.", "error");
        return;
      }

      try {
        const outputPath = outputPathFor(args, ctx.cwd, sessionFile);
        await mkdir(dirname(outputPath), { recursive: true });

        // Use Pi's own exporter so the output keeps the active export template and theme.
        const result = await pi.exec(
          "pi",
          ["--no-extensions", "--export", sessionFile, outputPath],
          { cwd: ctx.cwd, timeout: EXPORT_TIMEOUT_MS },
        );
        if (result.killed || result.code !== 0) {
          throw new Error(result.stderr.trim() || result.stdout.trim() || "Pi HTML export failed.");
        }

        const html = await readFile(outputPath, "utf8");
        await writeFile(outputPath, injectNoToolCss(html), "utf8");
        ctx.ui.notify(`No-tool HTML export written to ${outputPath}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`No-tool export failed: ${message}`, "error");
      }
  };

  // Interactive TUI handles Pi's built-in /export before extension commands,
  // so /export-notool is the explicit no-tool export command.
  pi.registerCommand("export-notool", {
    description: "Export the current session to HTML with tool-call blocks hidden",
    handler: exportNoTool,
  });
}
