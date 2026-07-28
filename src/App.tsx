import { Cloud, LockKeyhole, Radar, ShieldCheck } from "lucide-react";
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
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="Skill Reverse home">
          <span className="brand-mark">SR</span>
          <span>Skill Reverse</span>
        </a>
        <div className="header-status">
          <span className={`mode-dot mode-${config.mode}`} />
          {config.mode === "locked" ? "Setup locked" : config.mode === "demo" ? "Demo mode" : "Live"}
        </div>
        <a
          className="github-link"
          href="https://developers.cloudflare.com/workers/platform/deploy-buttons/"
          target="_blank"
          rel="noreferrer"
          aria-label="Cloudflare deployment guide"
        >
          <Cloud size={18} aria-hidden="true" />
        </a>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="hero-index">[01] REVERSE RESEARCH SYSTEM</span>
          <h1>
            看見結果
            <br />
            背後的<span>方法</span>
          </h1>
          <p>
            從公開成果反向提取一個可遷移的核心框架，再用作者脈絡、原始來源與職業基準檢查它。
          </p>
          <div className="hero-principles">
            <span><ShieldCheck size={16} /> Evidence before authority</span>
            <span><Radar size={16} /> One framework per run</span>
            <span><Cloud size={16} /> Cloudflare-native</span>
          </div>
        </div>
        <div className="hero-diagram" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="diagram-core">
            <span>RESULT</span>
            <strong>→</strong>
            <span>METHOD</span>
          </div>
          <div className="diagram-note note-a">SOURCE</div>
          <div className="diagram-note note-b">CONTEXT</div>
          <div className="diagram-note note-c">BASELINE</div>
        </div>
      </section>

      <section className="workspace">
        <div className="workspace-intro">
          <span className="eyebrow">Research workspace</span>
          <h2>一張表單，三層結論</h2>
          <p>職業共通知識、成果顯示的方法、作者獨有增量會被刻意分開。</p>
          <div className="layer-list">
            <article>
              <span>1</span>
              <div>
                <strong>Professional baseline</strong>
                <p>這個職業通常需要什麼</p>
              </div>
            </article>
            <article>
              <span>2</span>
              <div>
                <strong>Reverse framework</strong>
                <p>成果實際顯示了什麼</p>
              </div>
            </article>
            <article>
              <span>3</span>
              <div>
                <strong>Author delta</strong>
                <p>哪些做法真正值得提煉</p>
              </div>
            </article>
          </div>
          {config.mode === "locked" && (
            <div className="safety-note">
              <LockKeyhole size={18} aria-hidden="true" />
              Expensive endpoints remain closed until production setup passes.
            </div>
          )}
        </div>
        <ResearchForm
          config={config}
          busy={busy}
          onSubmit={startResearch}
          onOpenDemo={() => void loadReport("demo")}
        />
      </section>

      {job && <JobProgress job={job} />}

      <footer>
        <span>Skill Reverse / v0.1</span>
        <span>O*NET 30.3 · source-aware · no authority score</span>
      </footer>
    </main>
  );
}
