import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppSidebar, type SidebarView } from "./components/AppSidebar";
import { JobProgress } from "./components/JobProgress";
import { ReportView } from "./components/ReportView";
import { ResearchForm, type ResearchInput } from "./components/ResearchForm";
import type { JobStatus, PublicConfig, ReverseReport } from "./types";

const fallbackConfig: PublicConfig = {
  mode: "locked",
  turnstileSiteKey: ""
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

  const activeView: SidebarView = report ? (report.id === "demo" ? "pilot" : "report") : "new";

  return (
    <div className="app-shell">
      <AppSidebar
        mode={config.mode}
        activeView={activeView}
        reportTitle={report?.title}
        onNew={reset}
        onPilot={() => void loadReport("demo")}
      />

      <main className="app-content">
        {report ? (
          <ReportView report={report} onBack={reset} />
        ) : (
          <>
            <header className="site-header">
              <div className="breadcrumbs">
                <span>Workspace</span>
                <span>/</span>
                <strong>New reverse</strong>
              </div>
            </header>

            <div className="content-frame">
              <section className="hero">
                <div className="hero-copy">
                  <span className="eyebrow">New research</span>
                  <h1>Reverse a public result</h1>
                  <p>從公開成果提取可遷移的方法，再用來源、作者脈絡與職業基準驗證。</p>
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
                  <p>把職業共通知識、成果呈現的方法與作者特有增量分開閱讀。</p>
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
                </aside>
              </section>

              {job && <JobProgress job={job} />}

              <footer>
                <span>Skill Reverse / v0.2</span>
              </footer>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
