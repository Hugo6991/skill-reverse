import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const urlArg = process.argv.find((argument) => argument.startsWith("http"));
const rl = createInterface({ input, output });
const baseUrl = urlArg ?? (await rl.question("Deployment URL: ")).trim();
const capability = (await rl.question("Setup capability (blank for public health): ")).trim();
rl.close();

if (!baseUrl) {
  console.error("✕ A deployment URL is required");
  process.exit(1);
}

try {
  const endpoint = new URL("/api/health", baseUrl);
  if (capability) endpoint.searchParams.set("deep", "1");
  const response = await fetch(endpoint, {
    headers: capability ? { "x-setup-capability": capability } : {}
  });
  const health = await response.json();
  console.log(`\nSkill Reverse doctor — ${health.status}\n`);
  if (health.checks) {
    for (const [name, result] of Object.entries(health.checks)) {
      const optional = name === "social";
      console.log(`${result.ok ? "✓" : optional ? "!" : "✕"} ${name}: ${result.detail ?? ""}`);
    }
  } else {
    console.log(`✓ Public endpoint responded (${health.summary?.required}/${health.summary?.total})`);
    console.log("  Supply setup capability for binding-level diagnostics.");
  }
  if (!health.ok) {
    console.log("\nFix: run pnpm setup:prod; the expensive job endpoint remains locked.");
    process.exit(1);
  }
} catch (error) {
  console.error(`✕ Health request failed: ${error.message}`);
  console.error("Fix: verify the HTTPS deployment URL and inspect Workers Logs.");
  process.exit(1);
}
