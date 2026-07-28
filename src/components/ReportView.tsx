import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Fingerprint,
  Network,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import { useState } from "react";
import { withoutTerminalFullStop } from "../text";
import type { DeltaManifestation, EvidenceStatus, ReverseReport } from "../types";
import { EvidenceGraph } from "./EvidenceGraph";

const confidenceLabels: Record<EvidenceStatus, string> = {
  verified: "Verified",
  supported_inference: "Supported inference",
  plausible: "Plausible",
  unknown_contradicted: "Unknown / contradicted"
};

const deltaLabels: Record<DeltaManifestation, string> = {
  evidenced: "Visible in result",
  author_specific_extension: "Author-specific extension",
  missing_but_expected: "Missing but expected",
  not_observable: "Not observable",
  contradicted: "Contradicted"
};

export function ReportView({
  report,
  onBack
}: {
  report: ReverseReport;
  onBack(): void;
}) {
  const [tab, setTab] = useState<"framework" | "baseline" | "evidence">("framework");

  return (
    <main className="report-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        New docket
      </button>

      <header className="report-hero">
        <div className="report-kicker">
          <span>Reverse report</span>
          <span>{new Date(report.generatedAt).toLocaleDateString("zh-TW")}</span>
        </div>
        <h1>{withoutTerminalFullStop(report.title)}</h1>
        <p className="verdict">{withoutTerminalFullStop(report.verdict)}</p>
        <div className="report-meta">
          <a href={report.targetUrl} target="_blank" rel="noreferrer">
            {new URL(report.targetUrl).hostname}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
          <span>{report.occupation.title}</span>
          <span>{report.sources.length} sources</span>
          <span>{report.claims.length} claims</span>
        </div>
      </header>

      {report.degraded.length > 0 && (
        <div className="report-degraded">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <strong>Some evidence lanes were unavailable</strong>
            <span>
              {report.degraded.map(withoutTerminalFullStop).join(" · ")}
            </span>
          </div>
        </div>
      )}

      <nav className="report-tabs" aria-label="Report sections">
        <button className={tab === "framework" ? "active" : ""} onClick={() => setTab("framework")}>
          <Fingerprint size={17} aria-hidden="true" />
          Core framework
        </button>
        <button className={tab === "baseline" ? "active" : ""} onClick={() => setTab("baseline")}>
          <BookOpen size={17} aria-hidden="true" />
          Professional baseline
        </button>
        <button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}>
          <Network size={17} aria-hidden="true" />
          Evidence graph
        </button>
      </nav>

      {tab === "framework" && (
        <div className="report-grid">
          <section className="framework-panel">
            <span className="eyebrow">Core framework</span>
            <h2>{withoutTerminalFullStop(report.framework.name)}</h2>
            <p className="framework-summary">
              {withoutTerminalFullStop(report.framework.summary)}
            </p>
            <div className="when-grid">
              <div>
                <span>Use when</span>
                <p>{withoutTerminalFullStop(report.framework.useWhen)}</p>
              </div>
              <div>
                <span>Avoid when</span>
                <p>{withoutTerminalFullStop(report.framework.avoidWhen)}</p>
              </div>
            </div>
            <ol className="framework-steps">
              {report.framework.steps.map((step, index) => (
                <li key={`${step.title}-${index}`}>
                  <span className="framework-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <span className={`failure-tag failure-${step.failureType}`}>
                      {step.failureType}
                    </span>
                    <h3>{withoutTerminalFullStop(step.title)}</h3>
                    <p>{withoutTerminalFullStop(step.instruction)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <aside className="report-sidebar">
            <section className="author-card">
              <span className="eyebrow">Author context</span>
              <h2>{withoutTerminalFullStop(report.author.name)}</h2>
              {report.author.handle && <span className="author-handle">@{report.author.handle}</span>}
              <p>{withoutTerminalFullStop(report.author.background)}</p>
              <div className="context-note">
                {withoutTerminalFullStop(report.author.context)}
              </div>
            </section>
            <section className="claims-card">
              <div className="section-title-row">
                <h2>Claims ledger</h2>
                <ShieldCheck size={19} aria-hidden="true" />
              </div>
              <div className="claim-list">
                {report.claims.map((claim) => (
                  <article key={claim.id}>
                    <div className="claim-state">
                      {claim.status === "verified" ? (
                        <CheckCircle2 size={15} aria-hidden="true" />
                      ) : (
                        <CircleDashed size={15} aria-hidden="true" />
                      )}
                      <span>{confidenceLabels[claim.status]}</span>
                      <strong>{claim.confidence}</strong>
                    </div>
                    <p>{withoutTerminalFullStop(claim.text)}</p>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {tab === "baseline" && (
        <div className="baseline-layout">
          <section className="occupation-profile">
            <span className="eyebrow">Selected baseline</span>
            <h2>{report.occupation.title}</h2>
            <p>{withoutTerminalFullStop(report.occupation.description)}</p>
            <div className="occupation-source">
              <span>{report.occupation.code}</span>
              <span>O*NET {report.occupation.version}</span>
              <a href={report.occupation.sourceUri} target="_blank" rel="noreferrer">
                Source <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </section>
          <section className="delta-table" aria-label="Professional competency comparison">
            <div className="delta-heading">
              <span>Competency</span>
              <span>Result</span>
              <span>Evidence-aware interpretation</span>
            </div>
            {report.professionalDelta.map((delta) => (
              <article key={delta.competency.label}>
                <div>
                  <span className="competency-kind">{delta.competency.kind}</span>
                  <strong>{withoutTerminalFullStop(delta.competency.label)}</strong>
                  <small>Importance {delta.competency.importance}</small>
                </div>
                <span className={`delta-state delta-${delta.manifestation}`}>
                  {deltaLabels[delta.manifestation]}
                </span>
                <p>{withoutTerminalFullStop(delta.rationale)}</p>
              </article>
            ))}
          </section>
          <div className="baseline-caution">
            <strong>Absence of evidence is not evidence of absence</strong>
            <span>這張表描述成果能證明什麼，不用來評斷作者具不具備某項能力</span>
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <div className="evidence-layout">
          <section className="graph-panel">
            <div className="section-title-row">
              <div>
                <span className="eyebrow">Traceable reasoning</span>
                <h2>Source → observation → claim</h2>
              </div>
              <div className="graph-legend">
                <span><i className="legend-source" /> Source</span>
                <span><i className="legend-observation" /> Observation</span>
                <span><i className="legend-claim" /> Claim</span>
              </div>
            </div>
            <EvidenceGraph report={report} />
          </section>
          <section className="source-ledger">
            <h2>Source ledger</h2>
            {report.sources.map((source, index) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
                <span className="source-number">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.status.replaceAll("_", " ")}</small>
                </span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ))}
          </section>
          <section className="caveat-list">
            <h2>Interpretation limits</h2>
            <ul>
              {report.caveats.map((caveat) => (
                <li key={caveat}>{withoutTerminalFullStop(caveat)}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
