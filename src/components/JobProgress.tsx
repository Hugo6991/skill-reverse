import { Check, LoaderCircle } from "lucide-react";
import type { JobStage, JobStatus } from "../types";

const stages: Array<{ id: JobStage; label: string }> = [
  { id: "validate", label: "Validate" },
  { id: "occupation_confirmation", label: "Role" },
  { id: "capture", label: "Capture" },
  { id: "research", label: "Research" },
  { id: "source_verification", label: "Verify" },
  { id: "professional_baseline", label: "Baseline" },
  { id: "hypothesis_generation", label: "Frame" },
  { id: "report", label: "Report" }
];

export function JobProgress({ job }: { job: JobStatus }) {
  const currentIndex = stages.findIndex((stage) => stage.id === job.stage);
  return (
    <section className="progress-card" aria-live="polite">
      <div className="progress-heading">
        <div>
          <span className="eyebrow">Live research</span>
          <h2>{job.status === "failed" ? "Research stopped" : "Evidence is being assembled"}</h2>
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
          <strong>Degraded, not failed</strong>
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
  );
}
