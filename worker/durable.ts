import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./types";
import { durationBucket, trackWorkerEvent } from "./analytics";

interface ActorState {
  activeJobId?: string;
  day: string;
  jobsToday: number;
  outstanding: Array<{ jobId: string; acceptedDay: string }>;
}

export class ActorGate extends DurableObject<AppEnv> {
  async reserve(
    jobId: string,
    day: string,
    dailyJobLimit: number,
    outstandingJobLimit = 10
  ): Promise<{ ok: boolean; reason?: string }> {
    const current = (await this.ctx.storage.get<ActorState>("state")) ?? {
      day,
      jobsToday: 0,
      outstanding: []
    };
    const outstanding =
      current.outstanding ??
      (current.activeJobId
        ? [{ jobId: current.activeJobId, acceptedDay: current.day }]
        : []);
    const next: ActorState =
      current.day === day
        ? { day, jobsToday: current.jobsToday, outstanding }
        : { day, jobsToday: 0, outstanding };
    if (next.outstanding.some((item) => item.jobId === jobId)) return { ok: true };
    if (next.outstanding.length >= outstandingJobLimit) {
      return { ok: false, reason: "outstanding_job_limit" };
    }
    if (next.jobsToday >= dailyJobLimit) return { ok: false, reason: "daily_job_limit" };
    await this.ctx.storage.put("state", {
      ...next,
      jobsToday: next.jobsToday + 1,
      outstanding: [...next.outstanding, { jobId, acceptedDay: day }]
    });
    return { ok: true };
  }

  async release(jobId: string): Promise<void> {
    const current = await this.ctx.storage.get<ActorState>("state");
    const outstanding =
      current?.outstanding ??
      (current?.activeJobId
        ? [{ jobId: current.activeJobId, acceptedDay: current.day }]
        : []);
    if (!current || !outstanding.some((item) => item.jobId === jobId)) return;
    await this.ctx.storage.put("state", {
      day: current.day,
      jobsToday: current.jobsToday,
      outstanding: outstanding.filter((item) => item.jobId !== jobId)
    });
  }

  async rollback(jobId: string): Promise<void> {
    const current = await this.ctx.storage.get<ActorState>("state");
    const outstanding =
      current?.outstanding ??
      (current?.activeJobId
        ? [{ jobId: current.activeJobId, acceptedDay: current.day }]
        : []);
    const reservation = outstanding.find((item) => item.jobId === jobId);
    if (!current || !reservation) return;
    await this.ctx.storage.put("state", {
      day: current.day,
      jobsToday:
        reservation.acceptedDay === current.day
          ? Math.max(0, current.jobsToday - 1)
          : current.jobsToday,
      outstanding: outstanding.filter((item) => item.jobId !== jobId)
    });
  }

  async health(): Promise<{ ok: true; outstanding: number }> {
    const current = await this.ctx.storage.get<ActorState>("state");
    return {
      ok: true,
      outstanding:
        current?.outstanding?.length ?? (current?.activeJobId ? 1 : 0)
    };
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

interface PendingResearchJob {
  jobId: string;
  actorHash: string;
  queuedAt: string;
}

interface ActiveResearchJob extends PendingResearchJob {
  workflowId: string;
  startedAt: string;
}

interface SchedulerState {
  pending: PendingResearchJob[];
  active: Record<string, ActiveResearchJob>;
  leaseUntil?: string;
  lastReconciledAt?: string;
}

interface SchedulableJobRow {
  id: string;
  actor_hash: string;
  target_url: string;
  support_urls_json: string;
  occupation_code: string;
  capability_hash: string | null;
  workflow_id: string | null;
  reserved_cents: number;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  retry_count: number;
  status: string;
}

function positiveInteger(value: string | undefined, fallback: number, maximum = 100): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, Math.floor(parsed))
    : fallback;
}

export function nextEligiblePendingIndex(
  pending: Array<{ actorHash: string }>,
  activeByActor: Map<string, number>,
  actorLimit: number
): number {
  return pending.findIndex(
    (item) => (activeByActor.get(item.actorHash) ?? 0) < actorLimit
  );
}

export class ResearchScheduler extends DurableObject<AppEnv> {
  private async readState(): Promise<SchedulerState> {
    return (
      (await this.ctx.storage.get<SchedulerState>("scheduler")) ?? {
        pending: [],
        active: {}
      }
    );
  }

  private async writeState(state: SchedulerState): Promise<void> {
    await this.ctx.storage.put("scheduler", state);
    if (state.pending.length || Object.keys(state.active).length) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async loadJob(jobId: string): Promise<SchedulableJobRow | null> {
    return this.env.DB.prepare(
      `SELECT id, actor_hash, target_url, support_urls_json, occupation_code,
              capability_hash, workflow_id, reserved_cents, created_at, queued_at,
              started_at, retry_count, status
       FROM jobs WHERE id = ?1`
    )
      .bind(jobId)
      .first<SchedulableJobRow>();
  }

  async enqueue(jobId: string): Promise<{
    accepted: boolean;
    pending: number;
    active: number;
  }> {
    const row = await this.loadJob(jobId);
    const state = await this.readState();
    if (!row || row.status === "completed" || row.status === "failed") {
      return {
        accepted: false,
        pending: state.pending.length,
        active: Object.keys(state.active).length
      };
    }
    if (row.status === "running" && row.workflow_id) {
      state.pending = state.pending.filter((item) => item.jobId !== jobId);
      state.active[jobId] ??= {
        jobId,
        actorHash: row.actor_hash,
        queuedAt: row.queued_at ?? row.created_at,
        workflowId: row.workflow_id,
        startedAt: row.started_at ?? row.created_at
      };
      await this.writeState(state);
      await this.drain();
      const recovered = await this.readState();
      return {
        accepted: true,
        pending: recovered.pending.length,
        active: Object.keys(recovered.active).length
      };
    }
    if (row.status !== "queued") {
      return {
        accepted: false,
        pending: state.pending.length,
        active: Object.keys(state.active).length
      };
    }
    if (!state.active[jobId] && !state.pending.some((item) => item.jobId === jobId)) {
      state.pending.push({
        jobId,
        actorHash: row.actor_hash,
        queuedAt: row.queued_at ?? row.created_at
      });
      state.pending.sort(
        (left, right) =>
          left.queuedAt.localeCompare(right.queuedAt) || left.jobId.localeCompare(right.jobId)
      );
      await this.writeState(state);
    }
    await this.drain();
    const next = await this.readState();
    return {
      accepted: true,
      pending: next.pending.length,
      active: Object.keys(next.active).length
    };
  }

  async complete(jobId: string): Promise<void> {
    const state = await this.readState();
    delete state.active[jobId];
    state.pending = state.pending.filter((item) => item.jobId !== jobId);
    await this.writeState(state);
    await this.drain();
  }

  private async start(job: PendingResearchJob): Promise<ActiveResearchJob | null> {
    const row = await this.loadJob(job.jobId);
    if (!row || row.status !== "queued") return null;
    if (!row.capability_hash) {
      await this.env.DB.prepare(
        `UPDATE jobs
         SET status = 'failed', error_code = 'queue_payload_invalid',
             error_message = 'Queued job is missing its report capability',
             finished_at = ?1, updated_at = ?1
         WHERE id = ?2 AND status = 'queued'`
      )
        .bind(new Date().toISOString(), row.id)
        .run();
      await Promise.all([
        this.env.ACTOR_GATE.getByName(row.actor_hash).release(row.id),
        this.env.DAILY_BUDGET.getByName(row.created_at.slice(0, 10)).release(row.id)
      ]);
      await trackWorkerEvent(this.env, "research_failed", {
        jobId: row.id,
        eventId: `${row.id}:research_failed:queue_payload_invalid`,
        occupationCode: row.occupation_code,
        researchStage: "validate",
        errorCode: "queue_payload_invalid"
      });
      return null;
    }

    let workflowId = row.workflow_id;
    if (workflowId) {
      const workflow = await this.env.RESEARCH_WORKFLOW.get(workflowId);
      const workflowStatus = await workflow.status();
      if (
        workflowStatus.status === "errored" ||
        workflowStatus.status === "terminated" ||
        workflowStatus.status === "complete"
      ) {
        await workflow.restart({ from: { name: "reverse research with structured evidence" } });
      }
    } else {
      try {
        const workflow = await this.env.RESEARCH_WORKFLOW.create({
          id: row.id,
          params: {
            kind: "research",
            jobId: row.id,
            actorHash: row.actor_hash,
            targetUrl: row.target_url,
            supportUrls: JSON.parse(row.support_urls_json) as string[],
            occupationCode: row.occupation_code,
            capabilityHash: row.capability_hash,
            reservedCents: row.reserved_cents,
            day: row.created_at.slice(0, 10)
          }
        });
        workflowId = workflow.id;
      } catch (error) {
        // The stable job ID is the Workflow ID. If creation succeeded but the D1
        // update was interrupted, recover that instance instead of creating another.
        try {
          const existing = await this.env.RESEARCH_WORKFLOW.get(row.id);
          await existing.status();
          workflowId = existing.id;
        } catch {
          throw error;
        }
      }
    }

    const startedAt = new Date().toISOString();
    await this.env.DB.prepare(
      `UPDATE jobs
       SET workflow_id = ?1, status = 'running', stage = 'capture', progress = 8,
           started_at = COALESCE(started_at, ?2), updated_at = ?2
       WHERE id = ?3 AND status = 'queued'`
    )
      .bind(workflowId, startedAt, row.id)
      .run();
    await trackWorkerEvent(this.env, "research_running", {
      jobId: row.id,
      eventId: `${row.id}:research_running:${row.retry_count}`,
      occupationCode: row.occupation_code,
      researchStage: "capture",
      queueDurationBucket: durationBucket(row.queued_at ?? row.created_at, startedAt)
    });
    return { ...job, workflowId, startedAt };
  }

  private async reconcile(state: SchedulerState): Promise<boolean> {
    let changed = false;
    for (const [jobId, active] of Object.entries(state.active)) {
      const row = await this.env.DB.prepare(
        `SELECT status, actor_hash, created_at, actual_cents
         FROM jobs WHERE id = ?1`
      )
        .bind(jobId)
        .first<{
          status: string;
          actor_hash: string;
          created_at: string;
          actual_cents: number;
        }>();
      if (!row) {
        delete state.active[jobId];
        changed = true;
        continue;
      }
      if (row.status === "completed" || row.status === "failed") {
        const gateResults = await Promise.allSettled([
          this.env.ACTOR_GATE.getByName(row.actor_hash).release(jobId),
          this.env.DAILY_BUDGET.getByName(row.created_at.slice(0, 10)).settle(
            jobId,
            row.actual_cents
          )
        ]);
        if (gateResults.some((result) => result.status === "rejected")) {
          console.warn(
            JSON.stringify({
              event: "scheduler_settlement_deferred",
              jobId,
              message: "Actor or budget settlement is temporarily unavailable"
            })
          );
          continue;
        }
        delete state.active[jobId];
        changed = true;
        continue;
      }

      try {
        const workflow = await this.env.RESEARCH_WORKFLOW.get(active.workflowId);
        const status = await workflow.status();
        if (
          status.status === "errored" ||
          status.status === "terminated" ||
          status.status === "complete"
        ) {
          const now = new Date().toISOString();
          const failureUpdate = await this.env.DB.prepare(
            `UPDATE jobs
             SET status = 'failed', error_code = 'workflow_completion_lost',
                 error_message = ?1, finished_at = ?2, updated_at = ?2
             WHERE id = ?3 AND status = 'running'`
          )
            .bind(
              status.error?.message?.slice(0, 500) ??
                `Workflow reached ${status.status} without a terminal job update`,
              now,
              jobId
            )
            .run();
          if ((failureUpdate.meta.changes ?? 0) > 0) {
            await trackWorkerEvent(this.env, "research_failed", {
              jobId,
              eventId: `${jobId}:research_failed:workflow_completion_lost`,
              errorCode: "workflow_completion_lost"
            });
          }
          const gateResults = await Promise.allSettled([
            this.env.ACTOR_GATE.getByName(row.actor_hash).release(jobId),
            this.env.DAILY_BUDGET.getByName(row.created_at.slice(0, 10)).settle(
              jobId,
              row.actual_cents
            )
          ]);
          if (gateResults.some((result) => result.status === "rejected")) {
            console.warn(
              JSON.stringify({
                event: "scheduler_settlement_deferred",
                jobId,
                message: "Actor or budget settlement is temporarily unavailable"
              })
            );
            continue;
          }
          delete state.active[jobId];
          changed = true;
        }
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "scheduler_reconcile_deferred",
            jobId,
            message: error instanceof Error ? error.message : "workflow status unavailable"
          })
        );
      }
    }
    state.lastReconciledAt = new Date().toISOString();
    return changed;
  }

  private async drain(): Promise<void> {
    const state = await this.readState();
    state.leaseUntil = new Date(Date.now() + 65_000).toISOString();
    await this.reconcile(state);
    const globalLimit = positiveInteger(this.env.GLOBAL_RESEARCH_CONCURRENCY, 2, 20);
    const actorLimit = positiveInteger(this.env.ACTOR_ACTIVE_JOB_LIMIT, 1, 10);

    while (Object.keys(state.active).length < globalLimit && state.pending.length) {
      const activeByActor = new Map<string, number>();
      Object.values(state.active).forEach((item) => {
        activeByActor.set(item.actorHash, (activeByActor.get(item.actorHash) ?? 0) + 1);
      });
      const nextIndex = nextEligiblePendingIndex(state.pending, activeByActor, actorLimit);
      if (nextIndex < 0) break;
      const [next] = state.pending.splice(nextIndex, 1);
      try {
        const active = await this.start(next);
        if (active) state.active[next.jobId] = active;
      } catch (error) {
        state.pending.splice(nextIndex, 0, next);
        console.error(
          JSON.stringify({
            event: "scheduler_start_failed",
            jobId: next.jobId,
            message: error instanceof Error ? error.message : "unknown error"
          })
        );
        break;
      }
    }
    await this.writeState(state);
  }

  async alarm(): Promise<void> {
    await this.drain();
  }

  async health(): Promise<{ ok: true; pending: number; active: number }> {
    const state = await this.readState();
    return {
      ok: true,
      pending: state.pending.length,
      active: Object.keys(state.active).length
    };
  }
}
