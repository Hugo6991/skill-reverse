import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/backup-r2-artifacts.test.ts",
      "test/backfill-report-localizations.test.ts"
    ]
  }
});
