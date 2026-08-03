import { ArrowRight, FileSearch2, Globe2, Link2, LoaderCircle, LockKeyhole, Search } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../LocaleContext";
import { track } from "../analytics";
import type {
  HistoryItem,
  HistoryPage as HistoryResponse,
  OccupationProfile,
  PublicConfig
} from "../types";
import { Turnstile } from "./Turnstile";

export interface ResearchInput {
  targetUrl: string;
  occupationCode: string;
  turnstileToken: string;
}

export function FeaturedResearch() {
  const { copy, locale } = useLocale();
  const [featuredReports, setFeaturedReports] = useState<HistoryItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams({ limit: "3", lang: locale });
    void fetch(`/api/history?${search}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("featured research unavailable");
        const page = (await response.json()) as HistoryResponse;
        setFeaturedReports(page.items);
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setFeaturedReports([]);
        }
      });
    return () => controller.abort();
  }, [locale]);

  if (featuredReports.length === 0) return null;

  return (
    <section className="featured-research" aria-labelledby="featured-research-title">
      <h2 id="featured-research-title">{copy.home.featuredTitle}</h2>
      <div>
        {featuredReports.map((report) => (
          <a
            href={`/reports/${encodeURIComponent(report.reportId)}?lang=${encodeURIComponent(locale)}`}
            key={report.reportId}
          >
            <strong>{report.displayName}</strong>
            <small>{report.skillLabels[0] ?? report.occupationTitle}</small>
          </a>
        ))}
      </div>
    </section>
  );
}

function validatePublicUrl(
  value: string,
  messages: { invalidHttps: string; invalidUrl: string }
): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return messages.invalidHttps;
    return undefined;
  } catch {
    return messages.invalidUrl;
  }
}

export function ResearchForm({
  config,
  busy,
  onSubmit,
  onOpenDemo,
  onOpenReport
}: {
  config: PublicConfig;
  busy: boolean;
  onSubmit(input: ResearchInput): Promise<void>;
  onOpenDemo(): void;
  onOpenReport(reportId: string): void;
}) {
  const { copy, locale } = useLocale();
  const [targetUrl, setTargetUrl] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [occupationQuery, setOccupationQuery] = useState("");
  const [occupations, setOccupations] = useState<OccupationProfile[]>([]);
  const [occupation, setOccupation] = useState<OccupationProfile>();
  const [token, setToken] = useState(config.mode === "demo" ? "demo-token" : "");
  const [error, setError] = useState("");
  const [previousRuns, setPreviousRuns] = useState<HistoryItem[]>([]);
  const [checkingHistory, setCheckingHistory] = useState(false);
  const occupationInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!urlReady) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/occupations?q=${encodeURIComponent(occupationQuery.trim())}&lang=${encodeURIComponent(locale)}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(copy.home.occupationUnavailable);
        const data = (await response.json()) as { occupations: OccupationProfile[] };
        setOccupations(data.occupations);
        setOccupation((current) =>
          current && data.occupations.some((item) => item.code === current.code)
            ? current
            : undefined
        );
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : copy.home.occupationSearchFailed);
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [copy.home.occupationSearchFailed, copy.home.occupationUnavailable, locale, occupationQuery, urlReady]);

  useEffect(() => {
    if (urlReady) occupationInput.current?.focus();
  }, [urlReady]);

  useEffect(() => {
    if (!urlReady) {
      setPreviousRuns([]);
      setCheckingHistory(false);
      return;
    }
    const controller = new AbortController();
    setCheckingHistory(true);
    const search = new URLSearchParams({ limit: "3", targetUrl, lang: locale });
    void fetch(`/api/history?${search}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as HistoryResponse & {
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? copy.home.previousUnavailable);
        setPreviousRuns(body.items);
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setPreviousRuns([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingHistory(false);
      });
    return () => controller.abort();
  }, [copy.home.previousUnavailable, locale, targetUrl, urlReady]);

  const onToken = useCallback((value: string) => setToken(value), []);
  const onTurnstileError = useCallback((message: string) => setError(message), []);

  function continueFromUrl() {
    setError("");
    const problem = validatePublicUrl(targetUrl, copy.home);
    if (problem) {
      setError(problem);
      return;
    }
    setUrlReady(true);
    track("target_url_entered");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!urlReady) {
      continueFromUrl();
      return;
    }
    if (!occupation) {
      setError(copy.home.chooseOccupation);
      return;
    }
    if (!token && config.mode === "public") {
      setError(copy.home.completeVerification);
      return;
    }
    try {
      await onSubmit({
        targetUrl,
        occupationCode: occupation.code,
        turnstileToken: token || "demo-token"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.home.researchStartFailed);
      if (config.mode === "public") {
        setToken("");
        window.turnstile?.reset();
      }
    }
  }

  return (
    <section className="research-hero" aria-labelledby="research-title">
      <div className="hero-heading">
        <span className="eyebrow">{copy.home.eyebrow}</span>
        <h1 id="research-title">{copy.home.title}</h1>
        <p>{copy.home.description}</p>
      </div>

      <form className="hero-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="target-url">
          {copy.home.urlLabel}
        </label>
        <div className={urlReady ? "url-composer ready" : "url-composer"}>
          <Link2 size={20} aria-hidden="true" />
          <input
            id="target-url"
            data-clarity-mask="true"
            type="url"
            inputMode="url"
            required
            value={targetUrl}
            onChange={(event) => {
              setTargetUrl(event.target.value);
              if (urlReady) {
                setUrlReady(false);
                setOccupation(undefined);
              }
            }}
            placeholder={copy.home.urlPlaceholder}
          />
          {!urlReady && (
            <button className="composer-button" type="button" onClick={continueFromUrl}>
              {copy.home.continue}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
          {urlReady && (
            <button
              className="change-url-button"
              type="button"
              onClick={() => setUrlReady(false)}
            >
              {copy.home.changeUrl}
            </button>
          )}
        </div>

        {urlReady && (checkingHistory || previousRuns.length > 0) && (
          <section className="previous-runs" aria-labelledby="previous-runs-title">
            <div className="previous-runs-heading">
              <span className="previous-runs-icon">
                {checkingHistory ? (
                  <LoaderCircle className="spin" size={17} aria-hidden="true" />
                ) : (
                  <FileSearch2 size={17} aria-hidden="true" />
                )}
              </span>
              <div>
                <h2 id="previous-runs-title">
                  {checkingHistory ? copy.home.checkingPrevious : copy.home.previousTitle}
                </h2>
                <p>{copy.home.previousBody}</p>
              </div>
            </div>
            {!checkingHistory && (
              <div className="previous-runs-list">
                {previousRuns.map((run) => (
                  <button
                    type="button"
                    key={run.reportId}
                    onClick={() => onOpenReport(run.reportId)}
                  >
                    <span>
                      <strong>{run.displayName}</strong>
                      <small>{run.occupationTitle}</small>
                    </span>
                    <time dateTime={run.publishedAt}>
                      {new Intl.DateTimeFormat(locale, {
                        month: "short",
                        day: "numeric"
                      }).format(new Date(run.publishedAt))}
                    </time>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {urlReady && (
          <div className="occupation-stage">
            <div className="stage-heading">
              <div>
                <span className="stage-number">02</span>
                <h2>{copy.home.occupationLabel}</h2>
              </div>
              <p>{copy.home.occupationHelp}</p>
            </div>
            <div className="input-with-icon occupation-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={occupationInput}
                id="occupation-search"
                data-clarity-mask="true"
                value={occupationQuery}
                onChange={(event) => setOccupationQuery(event.target.value)}
                placeholder={copy.home.occupationPlaceholder}
              />
            </div>
            <div className="occupation-list" role="radiogroup" aria-label={copy.home.occupationAria}>
              {occupations.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={occupation?.code === item.code}
                  className={occupation?.code === item.code ? "occupation selected" : "occupation"}
                  key={item.code}
                  onClick={() => {
                    setOccupation(item);
                    track("occupation_selected", { occupation_code: item.code });
                  }}
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

            {config.mode === "public" && config.turnstileSiteKey && (
              <div className="verification-block">
                <span>{copy.home.humanVerification}</span>
                <Turnstile
                  siteKey={config.turnstileSiteKey}
                  onToken={onToken}
                  onError={onTurnstileError}
                />
              </div>
            )}

            {config.mode === "locked" ? (
              <div className="locked-notice" role="status">
                <LockKeyhole size={19} aria-hidden="true" />
                <div>
                  <strong>{copy.home.lockedTitle}</strong>
                  <span>{copy.home.lockedBody}</span>
                </div>
                <button className="secondary-button" type="button" onClick={onOpenDemo}>
                  {copy.home.openPilot}
                </button>
              </div>
            ) : (
              <>
                <div className="public-submission-note">
                  <Globe2 size={17} aria-hidden="true" />
                  <span>{copy.home.publicNotice}</span>
                </div>
                <button className="start-button primary-button" type="submit" disabled={busy}>
                  {busy ? copy.home.starting : copy.home.start}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="form-error hero-error" role="alert">
            <strong>{copy.home.checkStep}</strong>
            <span>{error}</span>
          </div>
        )}
      </form>
    </section>
  );
}
