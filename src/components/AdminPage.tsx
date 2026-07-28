import {
  ArrowUpRight,
  Eye,
  EyeOff,
  LoaderCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AdminReportItem } from "../types";

type AdminFilter = "all" | "published" | "hidden";

async function loadReports(filter: AdminFilter, query: string): Promise<AdminReportItem[]> {
  const search = new URLSearchParams({ limit: "100" });
  if (filter !== "all") search.set("status", filter);
  if (query.trim()) search.set("query", query.trim());
  const response = await fetch(`/api/admin/reports?${search}`);
  const body = (await response.json().catch(() => ({}))) as {
    items?: AdminReportItem[];
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "Reports could not be loaded");
  return body.items ?? [];
}

export function AdminPage({ onNavigate }: { onNavigate(path: string): void }) {
  const [items, setItems] = useState<AdminReportItem[]>([]);
  const [filter, setFilter] = useState<AdminFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<AdminReportItem>();
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await loadReports(filter, query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reports could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 180);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function changeVisibility(item: AdminReportItem) {
    const action = item.publicationStatus === "published" ? "hide" : "restore";
    const reason =
      action === "hide"
        ? window.prompt("Optional moderation note. This is visible only to the owner.", "") ?? ""
        : "";
    setBusyId(item.reportId);
    setError("");
    try {
      const response = await fetch(`/api/admin/reports/${encodeURIComponent(item.reportId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason })
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Visibility could not be changed");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Visibility could not be changed");
    } finally {
      setBusyId("");
    }
  }

  async function permanentlyDelete() {
    if (!pendingDelete || !deleteConfirmed) return;
    setBusyId(pendingDelete.reportId);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/reports/${encodeURIComponent(pendingDelete.reportId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(body.error?.message ?? "Report could not be deleted");
      }
      setPendingDelete(undefined);
      setDeleteConfirmed(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Report could not be deleted");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="page-frame admin-page">
      <header className="page-heading admin-heading">
        <span className="eyebrow">Owner controls</span>
        <h1>Public archive moderation</h1>
        <p>Hide questionable reports without destroying evidence, or permanently remove the full record.</p>
        <span className="admin-access-note">
          <ShieldCheck size={15} aria-hidden="true" />
          Protected by Cloudflare Access
        </span>
      </header>

      <section className="admin-toolbar" aria-label="Report filters">
        <label className="admin-search">
          <span className="sr-only">Search reports</span>
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or URL"
          />
        </label>
        <div className="admin-filters" role="group" aria-label="Publication status">
          {(["all", "published", "hidden"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "active" : undefined}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="inline-notice error-state" role="alert">
          <strong>Owner action could not be completed</strong>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" size={21} aria-hidden="true" />
          <span>Loading archive controls…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="page-state">
          <Eye size={21} aria-hidden="true" />
          <strong>No reports match this view</strong>
          <span>Change the filter or search phrase.</span>
        </div>
      ) : (
        <section className="admin-report-list" aria-label="Reports">
          {items.map((item) => {
            const busy = busyId === item.reportId;
            return (
              <article className="admin-report-row" key={item.reportId}>
                <div className="admin-report-main">
                  <span
                    className={`admin-state admin-state-${item.publicationStatus}`}
                    title={item.publicationStatus}
                  >
                    {item.publicationStatus === "published" ? (
                      <Eye size={15} aria-hidden="true" />
                    ) : (
                      <EyeOff size={15} aria-hidden="true" />
                    )}
                    {item.publicationStatus}
                  </span>
                  <h2>{item.title}</h2>
                  <a href={item.targetUrl} target="_blank" rel="noreferrer">
                    {new URL(item.targetUrl).hostname}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                  <p>
                    {item.occupationTitle ?? "Unknown occupation"}
                    {item.publishedAt
                      ? ` · ${new Intl.DateTimeFormat("zh-TW", {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(new Date(item.publishedAt))}`
                      : ""}
                  </p>
                  {item.moderationNote && <small>{item.moderationNote}</small>}
                </div>
                <div className="admin-report-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => void changeVisibility(item)}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={16} aria-hidden="true" />
                    ) : item.publicationStatus === "published" ? (
                      <EyeOff size={16} aria-hidden="true" />
                    ) : (
                      <RotateCcw size={16} aria-hidden="true" />
                    )}
                    {item.publicationStatus === "published" ? "Hide report" : "Restore report"}
                  </button>
                  <button
                    className="tertiary-button admin-delete-trigger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setPendingDelete(item);
                      setDeleteConfirmed(false);
                    }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Delete permanently
                  </button>
                  <button
                    className="tertiary-button"
                    type="button"
                    onClick={() => onNavigate(`/reports/${encodeURIComponent(item.reportId)}`)}
                  >
                    Open report
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {pendingDelete && (
        <div className="admin-dialog-backdrop" role="presentation">
          <section
            className="admin-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-report-title"
          >
            <span className="dialog-danger-icon">
              <Trash2 size={19} aria-hidden="true" />
            </span>
            <h2 id="delete-report-title">Permanently delete this report?</h2>
            <p>
              This removes the report, job record, saved text snapshot and screenshot. It cannot be
              restored from the application.
            </p>
            <strong>{pendingDelete.title}</strong>
            <label className="delete-confirmation">
              <input
                type="checkbox"
                checked={deleteConfirmed}
                onChange={(event) => setDeleteConfirmed(event.target.checked)}
              />
              I understand that this action is permanent
            </label>
            <div className="dialog-actions">
              <button
                className="danger-button"
                type="button"
                disabled={!deleteConfirmed || busyId === pendingDelete.reportId}
                onClick={() => void permanentlyDelete()}
              >
                {busyId === pendingDelete.reportId && (
                  <LoaderCircle className="spin" size={16} aria-hidden="true" />
                )}
                Delete report
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setPendingDelete(undefined);
                  setDeleteConfirmed(false);
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
