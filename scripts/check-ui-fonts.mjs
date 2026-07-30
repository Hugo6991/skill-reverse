import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const styles = readFileSync(
  fileURLToPath(new URL("../src/styles.css", import.meta.url)),
  "utf8"
);
const favicon = readFileSync(
  fileURLToPath(new URL("../public/favicon.svg", import.meta.url)),
  "utf8"
);

const declarations = [...styles.matchAll(/font-family:\s*([^;]+);/g)].map(
  ([, value]) => value.trim()
);
const allowedDeclarations = new Set(["var(--font-ui)", "inherit"]);
const invalidDeclarations = declarations.filter(
  (declaration) => !allowedDeclarations.has(declaration)
);
const splitFamilyPattern =
  /\b(?:ui-serif|ui-monospace|Songti TC|Noto Serif TC|SFMono-Regular|Consolas|monospace)\b/;
const controlsUseSharedFamily =
  /button,\s*input,\s*select,\s*textarea,\s*code,\s*pre\s*\{[^}]*font-family:\s*var\(--font-ui\);/s.test(
    styles
  );

const failures = [];

if (declarations.length === 0) {
  failures.push("No font-family declarations were found.");
}
if (invalidDeclarations.length > 0) {
  failures.push(
    `Font families must use --font-ui: ${[...new Set(invalidDeclarations)].join(", ")}`
  );
}
if (splitFamilyPattern.test(styles)) {
  failures.push("A serif or monospace display family was reintroduced.");
}
if (!controlsUseSharedFamily) {
  failures.push("Native controls and preformatted content must use --font-ui.");
}
if (/\bmonospace\b/.test(favicon)) {
  failures.push("The favicon must not use a separate monospace family.");
}

if (failures.length > 0) {
  console.error(`Typography check failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Typography check passed: ${declarations.length} font-family declarations use --font-ui or inherit.`
);
