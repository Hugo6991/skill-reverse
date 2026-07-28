import {
  ArrowRight,
  CircleAlert,
  Clock3,
  FileSearch2,
  Globe2,
  LoaderCircle
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { uiCopy } from "../copy";
import type {
  HistoryItem,
  HistoryPage as HistoryResponse,
  MyResearchItem,
  MyResearchPage
} from "../types";

async function loadHistory(cursor?: string): Promise<HistoryResponse> {
  const search = new URLSearchParams({ limit: "20" });
  if (cursor) search.set("cursor", cursor);
  const response = await fetch(`/api/history?${search}`);
  const body = (await response.json().catch(() => ({}))) as HistoryResponse & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? uiCopy.history.loadError);
  return body;
}

async function loadMyResearch(): Promise<MyResearchPage> {
  const response = await fetch("/api/my-jobs");
  const body = (await response.json().catch(() => ({}))) as MyResearchPage & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "Your research jobs are unavailable");
  return body;
}

export function HistoryPage({ onNavigate }: { onNavigate(path: string): void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [myResearch, setMyResearch] = useState<MyResearchItem[]>([]);
  const [myResearchLoading, setMyResearchLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const page = await loadHistory();
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiCopy.history.loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMyResearch = useCallback(async () => {
    try {
      const page = await loadMyResearch();
      setMyResearch(page.items);
    } catch {
      // The public archive remains useful if the anonymous session lookup is unavailable.
    } finally {
      setMyResearchLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshMyResearch();
  }, [refresh, refreshMyResearch]);

  useEffect(() => {
    if (!myResearch.some((item) => item.status === "queued" || item.status === "running")) {
      return;
    }
    const timer = window.setInterval(() => void refreshMyResearch(), 3_000);
    return () => window.clearInterval(timer);
  }, [myResearch, refreshMyResearch]);

  async function loadNextPage() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const page = await loadHistory(nextCursor);
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : uiCopy.history.loadError);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="page-frame history-page">
      <header className="page-heading">
        <span className="eyebrow">{uiCopy.history.eyebrow}</span>
        <h1>{uiCopy.history.title}</h1>
        <p>{uiCopy.history.description}</p>
        <span className="public-archive-note">
          <Globe2 size={15} aria-hidden="true" />
          {uiCopy.history.publicNote}
        </span>
      </header>

      {(myResearchLoading || myResearch.length > 0) && (
        <section className="my-research-section" aria-labelledby="my-research-title">
          <div className="history-section-heading">
            <div>
              <span className="eyebrow">This browser</span>
              <h2 id="my-research-title">Your research queue</h2>
            </div>
            <span>Updates automatically while work is queued or running</span>
          </div>
          {myResearchLoading ? (
            <div className="page-state compact-state" role="status">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>Checking your research jobs…</span>
            </div>
          ) : (
            <div className="history-list">
              {myResearch.map((item) => {
                const retrying = item.status === "running" && item.autoRetryCount > 0;
                const statusLabel =
                  item.status === "queued"
                    ? item.queuePosition
                      ? `Queued · #${item.queuePosition}`
                      : "Queued"
                    : retrying
                      ? `Retrying ${item.autoRetryCount}/1`
                      : item.status === "running"
                        ? "Running"
                        : "Failed";
                const Icon =
                  item.status === "failed"
                    ? CircleAlert
                    : item.status === "queued"
                      ? Clock3
                      : LoaderCircle;
                const timestamp =
                  item.finishedAt ?? item.startedAt ?? item.queuedAt ?? item.updatedAt;
                return (
                  <article className="history-row" key={item.jobId}>
                    <button
                      className="history-main"
                      type="button"
                      onClick={() => onNavigate(`/jobs/${encodeURIComponent(item.jobId)}`)}
                    >
                      <span className="history-icon">
                        <Icon
                          className={item.status === "running" ? "spin" : undefined}
                          size={17}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="history-copy">
                        <strong>{new URL(item.targetUrl).hostname}</strong>
                        <small>
                          {item.occupationTitle} · {item.stage.replaceAll("_", " ")}
                        </small>
                      </span>
                      <span className={`history-status status-${item.status}`}>
                        {statusLabel}
                      </span>
                      <time dateTime={timestamp}>
                        {new Intl.DateTimeFormat("zh-TW", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit"
                        }).format(new Date(timestamp))}
                      </time>
                      <ArrowRight className="history-arrow" size={16} aria-hidden="true" />
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <span>Loading public archive…</span>
        </div>
      ) : error && items.length === 0 ? (
        <div className="page-state error-state" role="alert">
          <strong>{uiCopy.history.loadError}</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            {uiCopy.history.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="page-state history-empty">
          <span className="empty-icon">
            <Globe2 size={22} aria-hidden="true" />
          </span>
          <strong>{uiCopy.history.emptyTitle}</strong>
          <span>{uiCopy.history.emptyBody}</span>
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            {uiCopy.history.emptyAction}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div className="inline-notice error-state" role="alert">
              <span>{error}</span>
            </div>
          )}
          <div className="history-section-heading public-history-heading">
            <div>
              <span className="eyebrow">Shared archive</span>
              <h2>Published reports</h2>
            </div>
          </div>
          <div className="history-list">
            {items.map((item) => (
              <article className="history-row" key={item.jobId}>
                <button
                  className="history-main"
                  type="button"
                  onClick={() => onNavigate(`/reports/${encodeURIComponent(item.reportId)}`)}
                >
                  <span className="history-icon">
                    <FileSearch2 size={17} aria-hidden="true" />
                  </span>
                  <span className="history-copy">
                    <strong>{item.displayName}</strong>
                    <small>
                      {item.sourceHost} · {item.occupationTitle}
                    </small>
                    {item.skillLabels.length > 0 && (
                      <span className="history-skills">
                        <span className="history-skill-label">Extracted</span>
                        {item.skillLabels.slice(0, 2).map((skill) => (
                          <span className="history-skill" key={skill} title={skill}>
                            {skill}
                          </span>
                        ))}
                        {item.skillLabels.length > 2 && (
                          <span className="history-skill-more">
                            +{item.skillLabels.length - 2}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="history-status status-completed">Published</span>
                  <time dateTime={item.publishedAt}>
                    {new Intl.DateTimeFormat("zh-TW", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    }).format(new Date(item.publishedAt))}
                  </time>
                  <ArrowRight className="history-arrow" size={16} aria-hidden="true" />
                </button>
              </article>
            ))}
          </div>
          {nextCursor && (
            <button
              className="secondary-button history-load-more"
              type="button"
              onClick={() => void loadNextPage()}
              disabled={loadingMore}
            >
              {loadingMore && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
              {loadingMore ? uiCopy.history.loadingMore : uiCopy.history.loadMore}
            </button>
          )}
        </>
      )}
    </main>
  );
}
