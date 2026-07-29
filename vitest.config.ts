import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
          PUBLIC_APP_URL: "https://example.com"
        }
      }
    }))
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
