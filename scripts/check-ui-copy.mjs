import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    })
  );
  return nested.flat();
}

const failures = [];
const sourceRoot = new URL("../src", import.meta.url).pathname;
for (const file of await sourceFiles(sourceRoot)) {
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (line.includes("。")) failures.push(`${file}:${index + 1}`);
    const quotedValues = [...line.matchAll(/(["'`])([^"'`\\]*(?:\\.[^"'`\\]*)*)\1/g)].map(
      (match) => match[2].trim()
    );
    const jsxValues = [...line.matchAll(/>([^<{]+)</g)].map((match) => match[1].trim());
    for (const value of [...quotedValues, ...jsxValues]) {
      if (value.endsWith(".") && !value.includes("://")) {
        failures.push(`${file}:${index + 1}`);
      }
    }
    if (
      !file.includes("/locales/") &&
      (line.includes('Intl.DateTimeFormat("zh-TW"') ||
        line.includes('toLocaleDateString("zh-TW"') ||
        /(?:aria-label|placeholder)="[^"]+"/.test(line) ||
        (/>[\s]*[A-Za-z\u4e00-\u9fff][^<{]*</u.test(line) &&
          !line.includes(">Skill Reverse<")))
    ) {
      failures.push(`${file}:${index + 1} (unlocalized UI copy)`);
    }
  });
}

for (const localeFile of ["zh-TW.ts", "en.ts"]) {
  const path = join(sourceRoot, "locales", localeFile);
  const lines = (await readFile(path, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (/:\s*""\s*[,}]/.test(line)) failures.push(`${path}:${index + 1} (empty translation)`);
  });
}

if (failures.length) {
  console.error("UI copy localization checks failed");
  [...new Set(failures)].forEach((failure) => console.error(`  ${failure}`));
  process.exit(1);
}

console.log("✓ UI copy is localized, non-empty, and uses consistent terminal punctuation");
