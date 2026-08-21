import assert from "node:assert/strict";
import test from "node:test";
import {
  findSensitiveInfo,
  formatSensitiveWarning,
} from "../extensions/pi-export-notool/sensitive-info.js";

test("findSensitiveInfo uses provider secret rules and detects common absolute paths", () => {
  // Keep the example token split in source so repository scanners do not flag the test fixture.
  const githubToken = ["ghp", "_", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join("");
  const value = {
    entries: [
      { content: `credential: ${githubToken}\nfiles: /Users/alice/work/private.txt and /.env` },
      { content: String.raw`Windows files: C:\Users and C:\Users\Alice\work\private.txt` },
      { content: String.raw`Network files: \\server\share and \\server\share\private\file.txt` },
    ],
  };

  const findings = findSensitiveInfo(value);

  assert.ok(findings.some((finding) => finding.kind === "secret" && finding.label === "Github V2"));
  assert.equal(findings.filter((finding) => finding.label === "Absolute POSIX path").length, 2);
  assert.equal(findings.filter((finding) => finding.label === "Absolute Windows path").length, 2);
  assert.equal(findings.filter((finding) => finding.label === "Absolute UNC path").length, 2);
  assert.ok(findings.every((finding) => !("text" in finding) && !("value" in finding)));
});

test("findSensitiveInfo ignores URLs, slash commands, and opaque image bytes", () => {
  const imageBytesThatLookLikeAToken = ["ghp", "_", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"].join("");
  const findings = findSensitiveInfo({
    text: "Visit https://example.com/path/to/page and run /export-notool",
    image: { type: "image", mimeType: "image/png", data: imageBytesThatLookLikeAToken },
  });

  assert.deepEqual(findings, []);
});

test("formatSensitiveWarning groups findings without echoing matched values", () => {
  const warning = formatSensitiveWarning([
    { kind: "secret", label: "Github V2", confidence: "high", location: "$.a" },
    { kind: "secret", label: "Github V2", confidence: "high", location: "$.b" },
    { kind: "absolute-path", label: "Absolute POSIX path", confidence: "medium", location: "$.c" },
  ]);

  assert.match(warning, /Github V2 \(high\): 2/);
  assert.match(warning, /Absolute POSIX path \(medium\): 1/);
  assert.match(warning, /Matched values are not shown/);
});
