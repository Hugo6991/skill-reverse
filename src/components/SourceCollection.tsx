import { ArrowRight, Link2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { uiCopy } from "../copy";
import type { JobStatus } from "../types";

export function SourceCollection({
  job,
  onSubmit
}: {
  job: JobStatus;
  onSubmit(urls: string[], finalize: boolean): Promise<void>;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const collection = job.sourceCollection;

  if (!collection?.open) {
    if (collection?.submittedCount) {
      return (
        <div className="source-complete" role="status">
          <span>{uiCopy.sources.saved}</span>
          <strong>{collection.submittedCount}</strong>
        </div>
      );
    }
    return null;
  }

  async function finalize(values: string[]) {
    setSaving(true);
    setError("");
    try {
      await onSubmit(values.filter(Boolean), true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sources could not be submitted");
      setSaving(false);
    }
  }

  return (
    <section className="source-collection">
      <div className="source-collection-heading">
        <div>
          <span className="eyebrow">{uiCopy.sources.eyebrow}</span>
          <h2>{uiCopy.sources.title}</h2>
          <p>
            {job.status === "queued"
              ? uiCopy.sources.queuedDescription
              : uiCopy.sources.description}
          </p>
        </div>
        {collection.closesAt && (
          <time dateTime={collection.closesAt}>
            Open until{" "}
            {new Intl.DateTimeFormat("zh-TW", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit"
            }).format(new Date(collection.closesAt))}
          </time>
        )}
      </div>

      {urls.length > 0 && (
        <div className="source-list">
          {urls.map((url, index) => (
            <div className="source-row" key={index}>
              <div className="input-with-icon">
                <Link2 size={17} aria-hidden="true" />
                <input
                  type="url"
                  inputMode="url"
                  aria-label={`Supporting source ${index + 1}`}
                  value={url}
                  onChange={(event) =>
                    setUrls((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item
                      )
                    )
                  }
                  placeholder={uiCopy.sources.placeholder}
                />
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove supporting source ${index + 1}`}
                onClick={() =>
                  setUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="source-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={saving || urls.length >= 8}
          onClick={() => setUrls((current) => [...current, ""])}
        >
          <Plus size={16} aria-hidden="true" />
          {uiCopy.sources.add}
        </button>
        <span className="source-action-spacer" />
        <button
          className="text-button"
          type="button"
          disabled={saving}
          onClick={() => void finalize([])}
        >
          {uiCopy.sources.skip}
        </button>
        {urls.length > 0 && (
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void finalize(urls)}
          >
            {saving ? uiCopy.sources.saving : uiCopy.sources.finish}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      {error && (
        <div className="form-error" role="alert">
          <strong>Sources need attention</strong>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
