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
for (const file of await sourceFiles(new URL("../src", import.meta.url).pathname)) {
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (line.includes("。")) failures.push(`${file}:${index + 1}`);
  });
}

if (failures.length) {
  console.error("UI copy must not contain the Chinese full stop character");
  failures.forEach((failure) => console.error(`  ${failure}`));
  process.exit(1);
}

console.log("✓ UI copy has no trailing Chinese full stops");
