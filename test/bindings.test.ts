import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { searchOccupations } from "../worker/occupations";
import type { AppEnv } from "../worker/types";

type TestEnv = AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const bindings = env as unknown as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});

describe("Cloudflare bindings in workerd", () => {
  it("queries the seeded O*NET catalog through D1", async () => {
    const results = await searchOccupations(bindings.DB, "web interface");
    expect(results[0]).toMatchObject({
      code: "15-1255.00",
      version: "30.3",
      provider: "O*NET"
    });
  });

  it("enforces one active job and two jobs per day in ActorGate", async () => {
    const actor = bindings.ACTOR_GATE.getByName(`test-${crypto.randomUUID()}`);
    expect(await actor.reserve("job-1", "2026-07-28")).toEqual({ ok: true });
    expect(await actor.reserve("job-2", "2026-07-28")).toMatchObject({
      ok: false,
      reason: "concurrent_job"
    });
    await actor.release("job-1");
    expect(await actor.reserve("job-2", "2026-07-28")).toEqual({ ok: true });
    await actor.release("job-2");
    expect(await actor.reserve("job-3", "2026-07-28")).toMatchObject({
      ok: false,
      reason: "daily_job_limit"
    });
  });

  it("reserves and settles the daily budget atomically", async () => {
    const budget = bindings.DAILY_BUDGET.getByName(`2026-07-28-${crypto.randomUUID()}`);
    expect(await budget.reserve("job-1", 50, 100)).toMatchObject({
      ok: true,
      remainingCents: 50
    });
    expect(await budget.reserve("job-2", 60, 100)).toMatchObject({
      ok: false,
      remainingCents: 50
    });
    await budget.settle("job-1", 12);
    expect(await budget.status(100)).toMatchObject({
      reservedCents: 0,
      actualCents: 12,
      remainingCents: 88
    });
  });
});
