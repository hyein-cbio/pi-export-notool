# pi-export-notool

A [Pi](https://pi.dev) extension that exports the current session to HTML while hiding tool-call, tool-output, and thinking blocks with injected CSS.

## Use

Start Pi with this extension, then run:

```text
/export-notool [output.html]
```

Pi's built-in `/export` remains unchanged. `/export-notool` creates an HTML variant without visible tool or thinking blocks.

If no path is supplied, it writes `pi-no-tools-<session-id>.html` in the current working directory. The output is created with Pi's built-in HTML exporter, then gets an idempotent stylesheet that hides `.tool-execution` and `.thinking-block` elements. The sidebar remains unchanged, so Pi's built-in **No-tools** toggle continues to work. Session data remains embedded in the file; the default command is display-only hiding.

### Publish mode

For an HTML file intended to be shared, put `--publish` before the optional path:

```text
/export-notool --publish [output.html]
```

Publish mode writes `pi-no-tools-publish-<session-id>.html` by default. It physically removes tool calls, tool results, shell executions, thinking blocks, hidden extension state, system prompts, tool schemas, rendered tool data, and path-bearing session header metadata from the embedded payload. Unknown entry and content-block types are omitted rather than assumed safe, and retained entries are re-parented so Pi's session tree still works. Pi's unsanitized intermediate export is created only in a temporary directory and deleted before the command returns.

The remaining visible textual conversation is scanned before it is written. Credential detection uses the MIT-licensed [`@sanity-labs/secret-scan`](https://github.com/sanity-labs/secret-scan) package; its distributed license attributes the incorporated detection rules to the MIT-licensed [Gitleaks](https://github.com/gitleaks/gitleaks) project. The extension also checks for POSIX, Windows, and UNC absolute paths. If it finds potential sensitive information, it shows grouped finding types without echoing matched values and requires confirmation. In a mode that cannot prompt, the publish export fails closed. Findings are warnings, not automatic redaction, and no pattern-based scanner can guarantee that content is safe to share.

## Development

Run the extension from this checkout:

```bash
pi --no-extensions -e .
```

Run its regression tests:

```bash
npm test
```

Publish a tested public release:

```bash
npm run publish:npm
```
