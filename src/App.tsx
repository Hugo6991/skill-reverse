import {
  ArrowRight,
  Cloud,
  FileSearch2,
  FlaskConical,
  Gauge,
  LockKeyhole,
  Plus,
  ScanSearch,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { JobProgress } from "./components/JobProgress";
import { ReportView } from "./components/ReportView";
import { ResearchForm, type ResearchInput } from "./components/ResearchForm";
import type { JobStatus, PublicConfig, ReverseReport } from "./types";

const fallbackConfig: PublicConfig = {
  mode: "locked",
  turnstileSiteKey: "",
  socialEnabled: false,
  limits: { jobsPerDay: 2, maxUrls: 9, maxJobUsd: 0.5 }
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  return body;
}

export default function App() {
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [job, setJob] = useState<JobStatus>();
  const [report, setReport] = useState<ReverseReport>();
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api<PublicConfig>("/api/config").then(setConfig).catch(() => setConfig(fallbackConfig));
    const reportId = new URLSearchParams(window.location.search).get("report");
    if (reportId) {
      api<ReverseReport>(`/api/reports/${encodeURIComponent(reportId)}`)
        .then(setReport)
        .catch(() => undefined);
    }
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  async function loadReport(reportId: string) {
    const next = await api<ReverseReport>(`/api/reports/${encodeURIComponent(reportId)}`);
    setReport(next);
    setBusy(false);
    window.history.replaceState({}, "", `?report=${encodeURIComponent(reportId)}`);
  }

  async function pollJob(jobId: string) {
    const next = await api<JobStatus>(`/api/jobs/${encodeURIComponent(jobId)}`);
    setJob(next);
    if (next.status === "completed" && next.reportId) {
      await loadReport(next.reportId);
      return;
    }
    if (next.status === "failed") {
      setBusy(false);
      return;
    }
    pollTimer.current = window.setTimeout(() => void pollJob(jobId), 1800);
  }

  async function startResearch(input: ResearchInput) {
    setBusy(true);
    const result = await api<{
      jobId: string;
      status: string;
      reportId?: string;
      capabilityToken: string;
    }>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    sessionStorage.setItem(`skill-reverse:${result.jobId}`, result.capabilityToken);
    if (result.reportId) {
      await loadReport(result.reportId);
    } else {
      setJob({
        id: result.jobId,
        status: "queued",
        stage: "validate",
        progress: 4,
        degraded: [],
        costUsd: 0
      });
      await pollJob(result.jobId);
    }
  }

  function reset() {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    setReport(undefined);
    setJob(undefined);
    setBusy(false);
    window.history.replaceState({}, "", window.location.pathname);
  }

  if (report) return <ReportView report={report} onBack={reset} />;

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a className="brand" href="/" aria-label="Skill Reverse home">
          <span className="brand-mark"><ScanSearch size={17} aria-hidden="true" /></span>
          <span>Skill Reverse</span>
        </a>

        <nav className="sidebar-nav" aria-label="Workspace">
          <button type="button" className="nav-item active">
            <Plus size={16} aria-hidden="true" />
            New reverse
          </button>
          <button type="button" className="nav-item" onClick={() => void loadReport("demo")}>
            <FileSearch2 size={16} aria-hidden="true" />
            Pilot report
          </button>
        </nav>

        <div className="sidebar-section">
          <span className="sidebar-label">Research standard</span>
          <div className="sidebar-fact">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Evidence before authority</span>
          </div>
          <div className="sidebar-fact">
            <FlaskConical size={15} aria-hidden="true" />
            <span>1 framework per run</span>
          </div>
          <div className="sidebar-fact">
            <Gauge size={15} aria-hidden="true" />
            <span>${config.limits.maxJobUsd.toFixed(2)} hard cap</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="header-status">
            <span className={`mode-dot mode-${config.mode}`} />
            {config.mode === "locked"
              ? "Setup locked"
              : config.mode === "demo"
                ? "Demo mode"
                : "Live"}
          </div>
          <span>O*NET 30.3</span>
        </div>
      </aside>

      <main className="app-content">
        <header className="site-header">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>New reverse</strong>
          </div>
          <a
            className="github-link"
            href="https://developers.cloudflare.com/workers/platform/deploy-buttons/"
            target="_blank"
            rel="noreferrer"
          >
            <Cloud size={16} aria-hidden="true" />
            Cloudflare setup
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </header>

        <div className="content-frame">
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">New research</span>
              <h1>Reverse a public result</h1>
              <p>
                從公開成果提取可遷移的方法，再用來源、作者脈絡與職業基準驗證。
              </p>
            </div>
            <div className="hero-flow" aria-label="Research flow">
              <span>Result</span>
              <ArrowRight size={14} aria-hidden="true" />
              <span>Evidence</span>
              <ArrowRight size={14} aria-hidden="true" />
              <strong>Method</strong>
            </div>
          </section>

          <section className="workspace">
            <ResearchForm
              config={config}
              busy={busy}
              onSubmit={startResearch}
              onOpenDemo={() => void loadReport("demo")}
            />

            <aside className="workspace-intro">
              <span className="eyebrow">Output model</span>
              <h2>3 層結論，刻意分開</h2>
              <p>避免把職業常識誤認成作者方法，也避免把聲量誤認成證據。</p>
              <div className="layer-list">
                <article>
                  <span>01</span>
                  <div>
                    <strong>Professional baseline</strong>
                    <p>這個職業通常需要什麼</p>
                  </div>
                </article>
                <article>
                  <span>02</span>
                  <div>
                    <strong>Reverse framework</strong>
                    <p>成果實際顯示了什麼</p>
                  </div>
                </article>
                <article>
                  <span>03</span>
                  <div>
                    <strong>Author delta</strong>
                    <p>哪些做法真正值得提煉</p>
                  </div>
                </article>
              </div>
              {config.mode === "locked" && (
                <div className="safety-note">
                  <LockKeyhole size={16} aria-hidden="true" />
                  <span>付費端點在 production setup 通過前保持關閉</span>
                </div>
              )}
            </aside>
          </section>

          {job && <JobProgress job={job} />}

          <footer>
            <span>Skill Reverse / v0.2</span>
            <span>Source-aware · no authority score</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
