import { ArrowLeft, Check, ExternalLink, LoaderCircle } from "lucide-react";
import type { JobStage, JobStatus } from "../types";
import { SourceCollection } from "./SourceCollection";

const stages: Array<{ id: JobStage; label: string }> = [
  { id: "validate", label: "Validate" },
  { id: "occupation_confirmation", label: "Role" },
  { id: "capture", label: "Capture" },
  { id: "source_collection", label: "Sources" },
  { id: "research", label: "Research" },
  { id: "source_verification", label: "Verify" },
  { id: "professional_baseline", label: "Baseline" },
  { id: "hypothesis_generation", label: "Frame" },
  { id: "report", label: "Report" }
];

export function JobProgress({
  job,
  onSubmitSources,
  onBack
}: {
  job: JobStatus;
  onSubmitSources(urls: string[], finalize: boolean): Promise<void>;
  onBack(): void;
}) {
  const currentIndex = stages.findIndex((stage) => stage.id === job.stage);
  return (
    <main className="page-frame job-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Research history
      </button>
      <section className="progress-card" aria-live="polite">
        <div className="progress-heading">
          <div>
            <span className="eyebrow">Live research</span>
            <h1>{job.status === "failed" ? "Research stopped" : "Evidence is being assembled"}</h1>
            {job.targetUrl && (
              <a href={job.targetUrl} target="_blank" rel="noreferrer">
                {new URL(job.targetUrl).hostname}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <span className="progress-percent">{job.progress}%</span>
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
            const active = index === currentIndex && job.status !== "completed";
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
        {job.degraded.length > 0 && (
          <div className="degraded-note">
            <strong>Some research lanes were unavailable</strong>
            <span>{job.degraded[job.degraded.length - 1]}</span>
          </div>
        )}
        {job.error && (
          <div className="form-error" role="alert">
            <strong>{job.error.code}</strong>
            <span>{job.error.message}</span>
          </div>
        )}
      </section>
      <SourceCollection job={job} onSubmit={onSubmitSources} />
    </main>
  );
}
