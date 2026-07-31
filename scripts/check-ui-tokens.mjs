import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function findUndefinedCustomProperties(styles) {
  const declarations = new Set(
    [...styles.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1])
  );
  const undefinedReferences = new Set();

  for (const match of styles.matchAll(/var\(\s*--([a-z0-9-]+)\s*(,|\))/gi)) {
    const [, name, terminator] = match;
    const hasFallback = terminator === ",";
    if (!hasFallback && !declarations.has(name)) {
      undefinedReferences.add(name);
    }
  }

  return [...undefinedReferences].sort();
}

const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const styles = readFileSync(
    fileURLToPath(new URL("../src/styles.css", import.meta.url)),
    "utf8"
  );
  const undefinedReferences = findUndefinedCustomProperties(styles);

  if (undefinedReferences.length > 0) {
    console.error(
      `CSS token check failed: undefined custom properties without fallbacks: ${undefinedReferences
        .map((name) => `--${name}`)
        .join(", ")}`
    );
    process.exit(1);
  }

  console.log("CSS token check passed: every custom property has a declaration or fallback.");
}
