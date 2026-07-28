import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./types";

interface ActorState {
  activeJobId?: string;
  day: string;
  jobsToday: number;
}

export class ActorGate extends DurableObject<AppEnv> {
  async reserve(
    jobId: string,
    day: string,
    dailyJobLimit: number
  ): Promise<{ ok: boolean; reason?: string }> {
    const current = (await this.ctx.storage.get<ActorState>("state")) ?? {
      day,
      jobsToday: 0
    };
    const next = current.day === day ? current : { day, jobsToday: 0 };
    if (next.activeJobId) return { ok: false, reason: "concurrent_job" };
    if (next.jobsToday >= dailyJobLimit) return { ok: false, reason: "daily_job_limit" };
    await this.ctx.storage.put("state", {
      ...next,
      activeJobId: jobId,
      jobsToday: next.jobsToday + 1
    });
    return { ok: true };
  }

  async release(jobId: string): Promise<void> {
    const current = await this.ctx.storage.get<ActorState>("state");
    if (current?.activeJobId === jobId) {
      await this.ctx.storage.put("state", { ...current, activeJobId: undefined });
    }
  }

  async rollback(jobId: string): Promise<void> {
    const current = await this.ctx.storage.get<ActorState>("state");
    if (current?.activeJobId === jobId) {
      await this.ctx.storage.put("state", {
        ...current,
        activeJobId: undefined,
        jobsToday: Math.max(0, current.jobsToday - 1)
      });
    }
  }

  async health(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

interface BudgetState {
  reservedCents: number;
  actualCents: number;
  reservations: Record<string, number>;
  settledByJob?: Record<string, number>;
}

export class DailyBudget extends DurableObject<AppEnv> {
  async reserve(
    jobId: string,
    cents: number,
    limitCents: number
  ): Promise<{ ok: boolean; remainingCents: number }> {
    const state = (await this.ctx.storage.get<BudgetState>("budget")) ?? {
      reservedCents: 0,
      actualCents: 0,
      reservations: {},
      settledByJob: {}
    };
    if (state.reservations[jobId]) {
      return {
        ok: true,
        remainingCents: Math.max(0, limitCents - state.actualCents - state.reservedCents)
      };
    }
    if (state.actualCents + state.reservedCents + cents > limitCents) {
      return {
        ok: false,
        remainingCents: Math.max(0, limitCents - state.actualCents - state.reservedCents)
      };
    }
    state.reservations[jobId] = cents;
    state.reservedCents += cents;
    await this.ctx.storage.put("budget", state);
    return {
      ok: true,
      remainingCents: limitCents - state.actualCents - state.reservedCents
    };
  }

  async settle(jobId: string, actualCents: number): Promise<void> {
    const state = (await this.ctx.storage.get<BudgetState>("budget")) ?? {
      reservedCents: 0,
      actualCents: 0,
      reservations: {},
      settledByJob: {}
    };
    const reserved = state.reservations[jobId] ?? 0;
    const previous = state.settledByJob?.[jobId] ?? 0;
    const cumulative = Math.max(previous, Math.max(0, actualCents));
    state.reservedCents = Math.max(0, state.reservedCents - reserved);
    state.actualCents += cumulative - previous;
    state.settledByJob = { ...(state.settledByJob ?? {}), [jobId]: cumulative };
    delete state.reservations[jobId];
    await this.ctx.storage.put("budget", state);
  }

  async release(jobId: string): Promise<void> {
    const state = await this.ctx.storage.get<BudgetState>("budget");
    if (!state) return;
    const reserved = state.reservations[jobId] ?? 0;
    state.reservedCents = Math.max(0, state.reservedCents - reserved);
    delete state.reservations[jobId];
    await this.ctx.storage.put("budget", state);
  }

  async status(limitCents: number): Promise<BudgetState & { remainingCents: number }> {
    const state = (await this.ctx.storage.get<BudgetState>("budget")) ?? {
      reservedCents: 0,
      actualCents: 0,
      reservations: {},
      settledByJob: {}
    };
    return {
      ...state,
      remainingCents: Math.max(0, limitCents - state.actualCents - state.reservedCents)
    };
  }
}
