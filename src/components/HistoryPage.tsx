import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileSearch2,
  Globe2,
  LoaderCircle
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../LocaleContext";
import { formatCopy } from "../locales";
import type { Locale } from "../types";
import type {
  HistoryPage as HistoryResponse,
  MyResearchItem,
  MyResearchPage
} from "../types";

const HISTORY_PAGE_SIZE = 20;

async function loadHistory(
  locale: Locale,
  errorMessage: string,
  cursor?: string
): Promise<HistoryResponse> {
  const search = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE), lang: locale });
  if (cursor) search.set("cursor", cursor);
  const response = await fetch(`/api/history?${search}`);
  const body = (await response.json().catch(() => ({}))) as HistoryResponse & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? errorMessage);
  return body;
}

async function loadMyResearch(
  locale: Locale,
  errorMessage: string
): Promise<MyResearchPage> {
  const response = await fetch(`/api/my-jobs?lang=${encodeURIComponent(locale)}`);
  const body = (await response.json().catch(() => ({}))) as MyResearchPage & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? errorMessage);
  return body;
}

export function HistoryPage({ onNavigate }: { onNavigate(path: string): void }) {
  const { copy, locale } = useLocale();
  const stageLabels: Record<MyResearchItem["stage"], string> = {
    validate: copy.job.validate,
    occupation_confirmation: copy.job.occupation,
    capture: copy.job.capture,
    source_collection: copy.job.sources,
    research: copy.job.research,
    source_verification: copy.job.verify,
    professional_baseline: copy.job.baseline,
    hypothesis_generation: copy.job.frame,
    translation: copy.job.translation,
    report: copy.job.report
  };
  const [historyPages, setHistoryPages] = useState<HistoryResponse[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [myResearch, setMyResearch] = useState<MyResearchItem[]>([]);
  const [myResearchLoading, setMyResearchLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState("");
  const publicHistoryHeading = useRef<HTMLHeadingElement>(null);
  const currentPage = historyPages[pageIndex];
  const items = currentPage?.items ?? [];
  const activeResearch = myResearch.filter((item) => item.status !== "failed");
  const failedResearch = myResearch.filter((item) => item.status === "failed");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setHistoryPages([]);
    setPageIndex(0);
    try {
      const page = await loadHistory(locale, copy.history.loadError);
      setHistoryPages([page]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.history.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.history.loadError, locale]);

  const refreshMyResearch = useCallback(async () => {
    try {
      const page = await loadMyResearch(locale, copy.history.jobsUnavailable);
      setMyResearch(page.items);
    } catch {
      // The public archive remains useful if the anonymous session lookup is unavailable.
    } finally {
      setMyResearchLoading(false);
    }
  }, [copy.history.jobsUnavailable, locale]);

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

  function returnToPublicHistory() {
    window.requestAnimationFrame(() => {
      publicHistoryHeading.current?.focus({ preventScroll: true });
      publicHistoryHeading.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start"
      });
    });
  }

  async function showNextPage() {
    if (pageLoading) return;
    if (historyPages[pageIndex + 1]) {
      setError("");
      setPageIndex((current) => current + 1);
      returnToPublicHistory();
      return;
    }
    if (!currentPage?.nextCursor) return;
    setPageLoading(true);
    setError("");
    try {
      const page = await loadHistory(locale, copy.history.loadError, currentPage.nextCursor);
      setHistoryPages((current) => [...current, page]);
      setPageIndex((current) => current + 1);
      returnToPublicHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.history.loadError);
    } finally {
      setPageLoading(false);
    }
  }

  function showPreviousPage() {
    if (pageLoading || pageIndex === 0) return;
    setError("");
    setPageIndex((current) => current - 1);
    returnToPublicHistory();
  }

  function renderResearchItem(item: MyResearchItem) {
    const retrying = item.status === "running" && item.autoRetryCount > 0;
    const statusLabel =
      item.status === "queued"
        ? item.queuePosition
          ? `${copy.history.queued} · #${item.queuePosition}`
          : copy.history.queued
        : retrying
          ? `${copy.history.retrying} ${item.autoRetryCount}/1`
          : item.status === "running"
            ? copy.history.running
            : copy.history.failed;
    const Icon =
      item.status === "failed"
        ? CircleAlert
        : item.status === "queued"
          ? Clock3
          : LoaderCircle;
    const timestamp = item.finishedAt ?? item.startedAt ?? item.queuedAt ?? item.updatedAt;

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
              {item.occupationTitle} · {stageLabels[item.stage]}
            </small>
          </span>
          <span className={`history-status status-${item.status}`}>{statusLabel}</span>
          <time dateTime={timestamp}>
            {new Intl.DateTimeFormat(locale, {
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
  }

  return (
    <main className="page-frame history-page" data-clarity-mask="true">
      <header className="page-heading">
        <span className="eyebrow">{copy.history.eyebrow}</span>
        <h1>{copy.history.title}</h1>
        <p>{copy.history.description}</p>
        <span className="public-archive-note">
          <Globe2 size={15} aria-hidden="true" />
          {copy.history.publicNote}
        </span>
      </header>

      {(myResearchLoading || activeResearch.length > 0) && (
        <section className="my-research-section" aria-labelledby="my-research-title">
          <div className="history-section-heading">
            <div>
              <span className="eyebrow">{copy.history.thisBrowser}</span>
              <h2 id="my-research-title">{copy.history.yourQueue}</h2>
            </div>
            <span>{copy.history.queueUpdates}</span>
          </div>
          {myResearchLoading ? (
            <div className="page-state compact-state" role="status">
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>{copy.history.checkingJobs}</span>
            </div>
          ) : (
            <div className="history-list">
              {activeResearch.map(renderResearchItem)}
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <span>{copy.common.loading}</span>
        </div>
      ) : error && items.length === 0 ? (
        <div className="page-state error-state" role="alert">
          <strong>{copy.history.loadError}</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            {copy.history.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="page-state history-empty">
          <span className="empty-icon">
            <Globe2 size={22} aria-hidden="true" />
          </span>
          <strong>{copy.history.emptyTitle}</strong>
          <span>{copy.history.emptyBody}</span>
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            {copy.history.emptyAction}
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
              <span className="eyebrow">{copy.history.sharedArchive}</span>
              <h2 ref={publicHistoryHeading} tabIndex={-1}>
                {copy.history.publishedReports}
              </h2>
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
                        <span className="history-skill-label">{copy.history.extracted}</span>
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
                  <span className="history-status status-completed">{copy.history.published}</span>
                  <time dateTime={item.publishedAt}>
                    {new Intl.DateTimeFormat(locale, {
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
          <nav className="history-pagination" aria-label={copy.history.paginationLabel}>
            <button
              className="secondary-button"
              type="button"
              onClick={showPreviousPage}
              disabled={pageIndex === 0 || pageLoading}
            >
              <ChevronLeft size={17} aria-hidden="true" />
              {copy.history.previousPage}
            </button>
            <span className="history-page-number" aria-live="polite">
              {formatCopy(copy.history.pageNumber, { page: pageIndex + 1 })}
            </span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void showNextPage()}
              disabled={!currentPage?.nextCursor || pageLoading}
            >
              {pageLoading && <LoaderCircle className="spin" size={17} aria-hidden="true" />}
              {copy.history.nextPage}
              {!pageLoading && <ChevronRight size={17} aria-hidden="true" />}
            </button>
          </nav>
        </>
      )}

      {failedResearch.length > 0 && (
        <section className="failed-research-section" aria-labelledby="failed-research-title">
          <div className="history-section-heading">
            <div>
              <span className="eyebrow">{copy.history.thisBrowser}</span>
              <h2 id="failed-research-title">{copy.history.failedResearch}</h2>
            </div>
            <span>{copy.history.failedResearchDescription}</span>
          </div>
          <div className="history-list">{failedResearch.map(renderResearchItem)}</div>
        </section>
      )}
    </main>
  );
}
