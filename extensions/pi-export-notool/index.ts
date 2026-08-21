import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExportNoToolHandler } from "./export-command.js";

export default function (pi: ExtensionAPI) {
  // Interactive TUI handles Pi's built-in /export before extension commands,
  // so /export-notool is the explicit no-tool export command.
  pi.registerCommand("export-notool", {
    description: "Export with tool blocks hidden; use --publish to physically remove them",
    handler: createExportNoToolHandler(pi),
  });
}
