import { ArrowLeft, Check, Clock3, ExternalLink, LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useState } from "react";
import { useLocale } from "../LocaleContext";
import type { JobStage, JobStatus } from "../types";
import { SourceCollection } from "./SourceCollection";
import { Turnstile } from "./Turnstile";

export function JobProgress({
  job,
  turnstileSiteKey,
  onSubmitSources,
  onRetry,
  onStartNew,
  onBack
}: {
  job: JobStatus;
  turnstileSiteKey: string;
  onSubmitSources(urls: string[], finalize: boolean): Promise<void>;
  onRetry(turnstileToken: string): Promise<void>;
  onStartNew(): void;
  onBack(): void;
}) {
  const { copy } = useLocale();
  const stages: Array<{ id: JobStage; label: string }> = [
    { id: "validate", label: copy.job.validate },
    { id: "occupation_confirmation", label: copy.job.occupation },
    { id: "capture", label: copy.job.capture },
    { id: "source_collection", label: copy.job.sources },
    { id: "research", label: copy.job.research },
    { id: "source_verification", label: copy.job.verify },
    { id: "professional_baseline", label: copy.job.baseline },
    { id: "hypothesis_generation", label: copy.job.frame },
    { id: "translation", label: copy.job.translation },
    { id: "report", label: copy.job.report }
  ];
  const currentIndex = stages.findIndex((stage) => stage.id === job.stage);
  const automaticRetrying =
    job.status === "running" && (job.retry?.automaticCount ?? 0) > 0;
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState("");
  const handleRetryToken = useCallback(
    async (token: string) => {
      if (!token) return;
      setRetryBusy(true);
      setRetryError("");
      try {
        await onRetry(token);
        setRetryOpen(false);
      } catch (error) {
        setRetryBusy(false);
        setRetryError(error instanceof Error ? error.message : copy.job.retryFailed);
      }
    },
    [copy.job.retryFailed, onRetry]
  );
  const handleTurnstileError = useCallback((message: string) => {
    setRetryError(message);
  }, []);
  return (
    <main className="page-frame job-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.job.back}
      </button>
      <section className="progress-card" aria-live="polite">
        <div className="progress-heading">
          <div>
            <span className="eyebrow">{copy.job.eyebrow}</span>
            <h1>
              {job.status === "queued"
                ? copy.job.queuedTitle
                : job.status === "failed"
                  ? copy.job.failedTitle
                  : automaticRetrying
                    ? copy.job.retryingTitle
                    : copy.job.runningTitle}
            </h1>
            {job.targetUrl && (
              <a href={job.targetUrl} target="_blank" rel="noreferrer">
                {new URL(job.targetUrl).hostname}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <span className="progress-percent">
            {job.status === "queued" && job.queuePosition
              ? `${copy.job.queue} #${job.queuePosition}`
              : `${job.progress}%`}
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job.progress}
        >
          <span style={{ width: `${job.progress}%` }} />
        </div>
        <ol className="stage-list">
          {stages.map((stage, index) => {
            const done = index < currentIndex || job.status === "completed";
            const active = index === currentIndex && job.status === "running";
            return (
              <li className={done ? "done" : active ? "active" : ""} key={stage.id}>
                <span className="stage-dot">
                  {done ? (
                    <Check size={12} aria-hidden="true" />
                  ) : active ? (
                    <LoaderCircle size={12} className="spin" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>{stage.label}</span>
              </li>
            );
          })}
        </ol>
        {job.status === "queued" && (
          <div className="queue-note" role="status">
            <Clock3 size={18} aria-hidden="true" />
            <div>
              <strong>
                {job.queuePosition
                  ? `${copy.job.approximateQueue} ${job.queuePosition}`
                  : copy.job.waitingSlot}
              </strong>
              <span>{copy.job.savedCanStartAnother}</span>
            </div>
            <button className="secondary-button" type="button" onClick={onStartNew}>
              {copy.job.startAnother}
            </button>
          </div>
        )}
        {automaticRetrying && (
          <div className="retrying-note" role="status">
            <RotateCw className="spin" size={18} aria-hidden="true" />
            <div>
              <strong>{copy.job.temporaryError}</strong>
              <span>
                {copy.job.automaticRetry} {job.retry?.automaticCount}/
                {job.retry?.automaticMax ?? 1}{copy.job.reusedSteps}
              </span>
            </div>
          </div>
        )}
        {job.degraded.length > 0 && (
          <div className="degraded-note">
            <strong>{copy.job.degraded}</strong>
            <span>{job.degraded[job.degraded.length - 1]}</span>
          </div>
        )}
        {job.error && (
          <div className="research-failure" role="alert">
            <div>
              <strong>{copy.job.needsAttempt}</strong>
              <span>{job.error.message}</span>
            </div>
            {job.retry?.allowed ? (
              <button
                className="secondary-button"
                type="button"
                disabled={retryBusy}
                onClick={() => {
                  setRetryError("");
                  setRetryOpen(true);
                }}
              >
                {retryBusy ? copy.job.startingRetry : copy.job.retry}
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={onStartNew}>
                {copy.job.startNew}
              </button>
            )}
          </div>
        )}
        {retryOpen && job.retry?.allowed && (
          <div className="retry-verification">
            <span className="eyebrow">{copy.job.confirmRetry}</span>
            <Turnstile
              siteKey={turnstileSiteKey}
              action="retry_research_job"
              onToken={handleRetryToken}
              onError={handleTurnstileError}
            />
            {retryError && <span className="retry-error">{retryError}</span>}
            <button
              type="button"
              className="text-button"
              disabled={retryBusy}
              onClick={() => setRetryOpen(false)}
            >
              {copy.common.cancel}
            </button>
          </div>
        )}
        {retryError && !retryOpen && (
          <div className="form-error" role="alert">
            <strong>{copy.job.retryUnavailable}</strong>
            <span>{retryError}</span>
          </div>
        )}
      </section>
      {job.status !== "failed" && <SourceCollection job={job} onSubmit={onSubmitSources} />}
    </main>
  );
}
