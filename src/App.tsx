import { ArrowRight, Brain, MessageSquareText, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { uiCopy } from "./copy";
import { AdminPage } from "./components/AdminPage";
import { CollectionPage } from "./components/CollectionPage";
import { HistoryPage } from "./components/HistoryPage";
import { JobProgress } from "./components/JobProgress";
import { PublicCardPage } from "./components/PublicCardPage";
import { ReportView } from "./components/ReportView";
import { ResearchForm, type ResearchInput } from "./components/ResearchForm";
import { type AppRoute, TopNav } from "./components/TopNav";
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

function hasRenderableGameProfile(report: ReverseReport): boolean {
  return (
    Array.isArray(report.gameProfile?.axes) &&
    report.gameProfile.axes.length === 6 &&
    report.gameProfile.rubricVersion === "game-profile-v2" &&
    typeof report.gameProfile.identity?.title === "string" &&
    typeof report.gameProfile.highlightAxisId === "string" &&
    typeof report.gameProfile.riskAxisId === "string"
  );
}

function parseRoute(): AppRoute {
  const legacyReport = new URLSearchParams(window.location.search).get("report");
  if (legacyReport) return { kind: "report", id: legacyReport };
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { kind: "home" };
  if (parts[0] === "admin") return { kind: "admin" };
  if (parts[0] === "history" && parts.length === 1) return { kind: "history" };
  if (parts[0] === "collection" && parts.length === 1) return { kind: "collection" };
  if (parts[0] === "jobs" && parts[1]) {
    return { kind: "job", id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "reports" && parts[1]) {
    return { kind: "report", id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "c" && parts[1]) {
    return { kind: "public_card", slug: decodeURIComponent(parts[1]) };
  }
  return { kind: "not_found" };
}

function OutputModel() {
  const layers = [
    {
      icon: ScanSearch,
      title: uiCopy.output.baseline,
      detail: uiCopy.output.baselineDetail
    },
    {
      icon: Brain,
      title: uiCopy.output.framework,
      detail: uiCopy.output.frameworkDetail
    },
    {
      icon: MessageSquareText,
      title: uiCopy.output.delta,
      detail: uiCopy.output.deltaDetail
    }
  ];
  return (
    <section className="output-section" aria-labelledby="output-title">
      <div className="output-heading">
        <span className="eyebrow">{uiCopy.output.eyebrow}</span>
        <h2 id="output-title">{uiCopy.output.title}</h2>
        <p>{uiCopy.output.description}</p>
      </div>
      <div className="output-grid">
        {layers.map(({ icon: Icon, title, detail }, index) => (
          <article key={title}>
            <span className="output-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="output-index">0{index + 1}</span>
            <strong>{title}</strong>
            <p>{detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [config, setConfig] = useState<PublicConfig>(fallbackConfig);
  const [route, setRoute] = useState<AppRoute>(() => parseRoute());
  const [job, setJob] = useState<JobStatus>();
  const [report, setReport] = useState<ReverseReport>();
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const pollTimer = useRef<number | undefined>(undefined);

  const navigate = useCallback((path: string, replace = false) => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    if (replace) window.history.replaceState({}, "", path);
    else window.history.pushState({}, "", path);
    setPageError("");
    setRoute(parseRoute());
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
      try {
        const next = await api<JobStatus>(`/api/jobs/${encodeURIComponent(jobId)}`);
        setJob(next);
        if (next.status === "completed" && next.reportId) {
          setBusy(false);
          navigate(`/reports/${encodeURIComponent(next.reportId)}`, true);
          return;
        }
        if (next.status === "failed") {
          setBusy(false);
          return;
        }
        pollTimer.current = window.setTimeout(() => void pollJob(jobId), 1800);
      } catch (caught) {
        setBusy(false);
        setPageError(caught instanceof Error ? caught.message : "Research status is unavailable");
      }
    },
    [navigate]
  );

  useEffect(() => {
    api<PublicConfig>("/api/config").then(setConfig).catch(() => setConfig(fallbackConfig));
    const onPopState = () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      setPageError("");
      setRoute(parseRoute());
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    setReport(undefined);
    setJob(undefined);
    setPageError("");
    if (route.kind === "report") {
      setBusy(true);
      api<ReverseReport>(`/api/reports/${encodeURIComponent(route.id)}`)
        .then((next) => {
          if (!hasRenderableGameProfile(next)) {
            throw new Error("This report needs an update before it can be opened");
          }
          setReport(next);
          setBusy(false);
        })
        .catch((caught) => {
          setBusy(false);
          setPageError(caught instanceof Error ? caught.message : "Report is unavailable");
        });
    } else if (route.kind === "job") {
      setBusy(true);
      void pollJob(route.id);
    } else {
      setBusy(false);
    }
  }, [pollJob, route]);

  async function startResearch(input: ResearchInput) {
    setBusy(true);
    try {
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
        navigate(`/reports/${encodeURIComponent(result.reportId)}`);
        return;
      }
      setJob({
        id: result.jobId,
        status: "queued",
        stage: "validate",
        progress: 4,
        targetUrl: input.targetUrl,
        occupationCode: input.occupationCode,
        degraded: [],
        costUsd: 0,
        sourceCollection: { open: true, submittedCount: 0 }
      });
      navigate(`/jobs/${encodeURIComponent(result.jobId)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitSources(urls: string[], finalize: boolean) {
    if (route.kind !== "job") return;
    await api(`/api/jobs/${encodeURIComponent(route.id)}/sources`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls, finalize })
    });
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    await pollJob(route.id);
  }

  async function retryResearch(turnstileToken: string) {
    if (route.kind !== "job") return;
    const result = await api<Partial<JobStatus>>(
      `/api/jobs/${encodeURIComponent(route.id)}/retry`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken })
      }
    );
    setJob((current) =>
      current
        ? {
            ...current,
            ...result,
            status: result.status ?? "queued",
            stage: result.stage ?? "source_verification",
            progress: result.progress ?? 62,
            error: undefined
          }
        : current
    );
    setBusy(true);
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    await pollJob(route.id);
  }

  function renderPage() {
    if (route.kind === "home") {
      return (
        <main className="home-page">
          <div className="home-frame">
            <ResearchForm
              config={config}
              busy={busy}
              onSubmit={startResearch}
              onOpenDemo={() => navigate("/reports/demo")}
              onOpenReport={(reportId) => navigate(`/reports/${encodeURIComponent(reportId)}`)}
            />
            <OutputModel />
          </div>
        </main>
      );
    }
    if (route.kind === "admin") return <AdminPage onNavigate={navigate} />;
    if (route.kind === "history") return <HistoryPage onNavigate={navigate} />;
    if (route.kind === "collection") return <CollectionPage onNavigate={navigate} />;
    if (route.kind === "public_card") {
      return <PublicCardPage slug={route.slug} onNavigate={navigate} />;
    }
    if (route.kind === "job" && job) {
      return (
        <JobProgress
          job={job}
          turnstileSiteKey={config.turnstileSiteKey}
          onSubmitSources={submitSources}
          onRetry={retryResearch}
          onStartNew={() => navigate("/")}
          onBack={() => navigate("/collection")}
        />
      );
    }
    if (route.kind === "report" && report) {
      return <ReportView report={report} onBack={() => navigate("/")} />;
    }
    if (route.kind === "not_found") {
      return (
        <main className="page-frame page-state not-found">
          <strong>Page not found</strong>
          <span>The page may have moved or expired</span>
          <button className="primary-button" type="button" onClick={() => navigate("/")}>
            Start a reverse
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </main>
      );
    }
    if (pageError) {
      return (
        <main className="page-frame page-state error-state" role="alert">
          <strong>This page could not be opened</strong>
          <span>{pageError}</span>
          <button className="secondary-button" type="button" onClick={() => navigate("/")}>
            Return home
          </button>
        </main>
      );
    }
    return (
      <main className="page-frame page-state" role="status">
        <span className="loading-mark" />
        <span>Loading…</span>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <TopNav route={route} onNavigate={navigate} />
      {renderPage()}
    </div>
  );
}
