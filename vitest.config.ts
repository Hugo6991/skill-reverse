import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

const nodeBackupTest = "test/backup-r2-artifacts.test.ts";
const nodeBackupTestRequested = process.argv.some((argument) =>
  argument.replaceAll("\\", "/").endsWith(nodeBackupTest)
);

const nodeConfig = defineConfig({
  test: {
    environment: "node",
    include: [nodeBackupTest]
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
    exclude: [...configDefaults.exclude, nodeBackupTest]
  }
});

export default nodeBackupTestRequested ? nodeConfig : cloudflareConfig;
