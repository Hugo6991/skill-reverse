import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

const nodeTests = [
  "test/backup-r2-artifacts.test.ts",
  "test/backfill-report-localizations.test.ts"
];
const nodeTestRequested = process.argv.some((argument) =>
  nodeTests.some((test) => argument.replaceAll("\\", "/").endsWith(test))
);

const nodeConfig = defineConfig({
  test: {
    environment: "node",
    include: nodeTests
  }
});

const cloudflareConfig = defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./worker/index.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          APP_MODE: "demo",
          ANON_SESSION_SECRET: "test-only-anonymous-session-secret",
          PUBLIC_APP_URL: "https://example.com",
          OPENROUTER_API_KEY: "test-only"
        }
      }
    }))
  ],
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...nodeTests]
  }
});

export default nodeTestRequested ? nodeConfig : cloudflareConfig;
