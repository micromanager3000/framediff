import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "*.css",
  "*.html",
  "*.svelte",
], { encoding: "utf8" }).trim().split("\n").filter(Boolean);

const forbidden = [
  {
    label: "a 2–3px left-edge rule",
    pattern: /border-left\s*:\s*[23]px\b/i,
  },
  {
    label: "a 2–3px inset edge rule",
    pattern: /box-shadow\s*:\s*inset\s+-?[23]px\s+0\s+0\b/i,
  },
];

const violations = [];
for (const file of files) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) violations.push(`${file}:${index + 1} uses ${rule.label}`);
    }
  }
}

if (violations.length) {
  console.error([
    "UI convention check failed.",
    ...violations.map((violation) => `- ${violation}`),
    "Use a background tint or an existing badge/icon/label to convey state and severity.",
  ].join("\n"));
  process.exitCode = 1;
}
