import { ArrowRight, Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import { useLocale } from "../LocaleContext";
import type { JobStatus } from "../types";

export function SourceCollection({
  job,
  onSubmit
}: {
  job: JobStatus;
  onSubmit(urls: string[], finalize: boolean): Promise<void>;
}) {
  const { copy, locale } = useLocale();
  const [urls, setUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const collection = job.sourceCollection;
  const viewedJobId = useRef("");

  useEffect(() => {
    if (!collection?.open || viewedJobId.current === job.id) return;
    viewedJobId.current = job.id;
    track("source_collection_viewed", {
      occupation_code: job.occupationCode,
      research_stage: job.stage,
      source_count: collection.submittedCount
    });
  }, [
    collection?.open,
    collection?.submittedCount,
    job.id,
    job.occupationCode,
    job.stage
  ]);

  if (!collection?.open) {
    if (collection?.submittedCount) {
      return (
        <div className="source-complete" role="status">
          <span>{copy.sources.saved}</span>
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
      setError(caught instanceof Error ? caught.message : copy.sources.submitFailed);
      setSaving(false);
    }
  }

  return (
    <section className="source-collection">
      <div className="source-collection-heading">
        <div>
          <span className="eyebrow">{copy.sources.eyebrow}</span>
          <h2>{copy.sources.title}</h2>
          <p>
            {job.status === "queued"
              ? copy.sources.queuedDescription
              : copy.sources.description}
          </p>
        </div>
        {collection.closesAt && (
          <time dateTime={collection.closesAt}>
            {copy.sources.openUntil}{" "}
            {new Intl.DateTimeFormat(locale, {
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
                  data-clarity-mask="true"
                  inputMode="url"
                  aria-label={`${copy.sources.supportingSource} ${index + 1}`}
                  value={url}
                  onChange={(event) =>
                    setUrls((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item
                      )
                    )
                  }
                  placeholder={copy.sources.placeholder}
                />
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={`${copy.sources.removeSource} ${index + 1}`}
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
          {copy.sources.add}
        </button>
        <span className="source-action-spacer" />
        <button
          className="text-button"
          type="button"
          disabled={saving}
          onClick={() => void finalize([])}
        >
          {copy.sources.skip}
        </button>
        {urls.length > 0 && (
          <button
            className="primary-button"
            type="button"
            disabled={saving}
            onClick={() => void finalize(urls)}
          >
            {saving ? copy.sources.saving : copy.sources.finish}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
      </div>

      {error && (
        <div className="form-error" role="alert">
          <strong>{copy.sources.attention}</strong>
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
