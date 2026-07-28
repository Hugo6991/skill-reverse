import { ArrowRight, Link2, LockKeyhole, Plus, Search, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { OccupationProfile, PublicConfig } from "../types";
import { Turnstile } from "./Turnstile";

export interface ResearchInput {
  targetUrl: string;
  supportUrls: string[];
  occupationCode: string;
  turnstileToken: string;
}

export function ResearchForm({
  config,
  busy,
  onSubmit,
  onOpenDemo
}: {
  config: PublicConfig;
  busy: boolean;
  onSubmit(input: ResearchInput): Promise<void>;
  onOpenDemo(): void;
}) {
  const [targetUrl, setTargetUrl] = useState("https://antfu.me");
  const [supportUrls, setSupportUrls] = useState<string[]>([]);
  const [occupationQuery, setOccupationQuery] = useState("web interface");
  const [occupations, setOccupations] = useState<OccupationProfile[]>([]);
  const [occupation, setOccupation] = useState<OccupationProfile>();
  const [token, setToken] = useState(config.mode === "demo" ? "demo-token" : "");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/occupations?q=${encodeURIComponent(occupationQuery.trim())}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("Occupation catalog is unavailable");
        const data = (await response.json()) as { occupations: OccupationProfile[] };
        setOccupations(data.occupations);
        setOccupation((current) => {
          if (current && data.occupations.some((item) => item.code === current.code)) return current;
          return data.occupations[0];
        });
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "Occupation search failed");
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [occupationQuery]);

  const onToken = useCallback((value: string) => setToken(value), []);
  const onTurnstileError = useCallback((message: string) => setError(message), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!occupation) {
      setError("Select exactly one occupation");
      return;
    }
    if (!token && config.mode === "public") {
      setError("Complete human verification before starting");
      return;
    }
    try {
      await onSubmit({
        targetUrl,
        supportUrls: supportUrls.filter(Boolean),
        occupationCode: occupation.code,
        turnstileToken: token || "demo-token"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The research job could not start");
      if (config.mode === "public") {
        setToken("");
        window.turnstile?.reset();
      }
    }
  }

  return (
    <section className="docket" aria-labelledby="research-form-title">
      <div className="docket-heading">
        <div>
          <span className="eyebrow">New research docket</span>
          <h2 id="research-form-title">從成果開始，不從故事開始</h2>
        </div>
        <span className="docket-number">SR—001</span>
      </div>

      {config.mode === "locked" && (
        <div className="locked-notice" role="status">
          <LockKeyhole size={20} aria-hidden="true" />
          <div>
            <strong>Research jobs are not available yet</strong>
            <span>You can explore the pilot report while the service is being prepared.</span>
          </div>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="form-step">
          <span className="step-index">01</span>
          <div className="step-body">
            <label htmlFor="target-url">主要成果網址</label>
            <p className="field-help">網站是研究起點；GitHub、文章與 X 貼文放在下一步</p>
            <div className="input-with-icon">
              <Link2 size={18} aria-hidden="true" />
              <input
                id="target-url"
                type="url"
                inputMode="url"
                required
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="https://example.com"
              />
            </div>
          </div>
        </div>

        <div className="form-step">
          <span className="step-index">02</span>
          <div className="step-body">
            <div className="field-title-row">
              <div>
                <label>輔助來源</label>
                <p className="field-help">最多 8 個。第一方原始來源優先</p>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={supportUrls.length >= 8}
                onClick={() => setSupportUrls((items) => [...items, ""])}
              >
                <Plus size={16} aria-hidden="true" />
                Add source
              </button>
            </div>
            {supportUrls.length === 0 ? (
              <button
                type="button"
                className="empty-source"
                onClick={() => setSupportUrls(["https://github.com/antfu/antfu.me"])}
              >
                <Plus size={18} aria-hidden="true" />
                加入 GitHub、文章、文件或 X 貼文
              </button>
            ) : (
              <div className="source-list">
                {supportUrls.map((url, index) => (
                  <div className="source-row" key={index}>
                    <input
                      aria-label={`Supporting source ${index + 1}`}
                      type="url"
                      value={url}
                      onChange={(event) =>
                        setSupportUrls((items) =>
                          items.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item
                          )
                        )
                      }
                      placeholder="https://github.com/owner/repo"
                    />
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove source ${index + 1}`}
                      onClick={() =>
                        setSupportUrls((items) => items.filter((_, itemIndex) => itemIndex !== index))
                      }
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="form-step">
          <span className="step-index">03</span>
          <div className="step-body">
            <label htmlFor="occupation-search">對應職業</label>
            <p className="field-help">職業是比較基準，不是對作者能力的評分</p>
            <div className="input-with-icon">
              <Search size={18} aria-hidden="true" />
              <input
                id="occupation-search"
                value={occupationQuery}
                onChange={(event) => setOccupationQuery(event.target.value)}
                placeholder="Search O*NET occupations"
              />
            </div>
            <div className="occupation-list" role="radiogroup" aria-label="Select one occupation">
              {occupations.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={occupation?.code === item.code}
                  className={occupation?.code === item.code ? "occupation selected" : "occupation"}
                  key={item.code}
                  onClick={() => setOccupation(item)}
                >
                  <span className="radio-mark" aria-hidden="true" />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.code} · O*NET {item.version}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {config.mode === "public" && config.turnstileSiteKey && (
          <div className="form-step compact-step">
            <span className="step-index">04</span>
            <div className="step-body">
              <label>Human verification</label>
              <Turnstile
                siteKey={config.turnstileSiteKey}
                onToken={onToken}
                onError={onTurnstileError}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="form-error" role="alert">
            <strong>Research cannot start</strong>
            <span>{error}</span>
          </div>
        )}

        <div className="form-actions">
          {config.mode === "locked" ? (
            <button type="button" className="primary-button" onClick={onOpenDemo}>
              Open demo dossier
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Opening docket…" : "Start reverse research"}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
