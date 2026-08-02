# pi-export-notool

A [Pi](https://pi.dev) extension that exports the current session to HTML while hiding tool-call, tool-output, and thinking blocks with injected CSS.

## Use

Start Pi with this extension, then run:

```text
/export-notool [output.html]
```

Pi's built-in `/export` remains unchanged. `/export-notool` creates an HTML variant without tool or thinking blocks.

If no path is supplied, it writes `pi-no-tools-<session-id>.html` in the current working directory. The output is created with Pi's built-in HTML exporter, then gets an idempotent stylesheet that hides `.tool-execution` and `.thinking-block` elements. The sidebar remains unchanged, so Pi's built-in **No-tools** toggle continues to work. Session data remains embedded in the file; this is display-only hiding.

## Development

Run the extension from this checkout:

```bash
pi --no-extensions -e .
```

Run its regression tests:

```bash
npm test
```
