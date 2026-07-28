import { ArrowRight, Link2, LockKeyhole, Search } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { uiCopy } from "../copy";
import type { OccupationProfile, PublicConfig } from "../types";
import { Turnstile } from "./Turnstile";

export interface ResearchInput {
  targetUrl: string;
  occupationCode: string;
  turnstileToken: string;
}

function validatePublicUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "Enter a public HTTPS URL";
    return undefined;
  } catch {
    return "Enter a complete URL such as https://example.com";
  }
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
  const [targetUrl, setTargetUrl] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [occupationQuery, setOccupationQuery] = useState("");
  const [occupations, setOccupations] = useState<OccupationProfile[]>([]);
  const [occupation, setOccupation] = useState<OccupationProfile>();
  const [token, setToken] = useState(config.mode === "demo" ? "demo-token" : "");
  const [error, setError] = useState("");
  const occupationInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!urlReady) return;
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
        setOccupation((current) =>
          current && data.occupations.some((item) => item.code === current.code)
            ? current
            : undefined
        );
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
  }, [occupationQuery, urlReady]);

  useEffect(() => {
    if (urlReady) occupationInput.current?.focus();
  }, [urlReady]);

  const onToken = useCallback((value: string) => setToken(value), []);
  const onTurnstileError = useCallback((message: string) => setError(message), []);

  function continueFromUrl() {
    setError("");
    const problem = validatePublicUrl(targetUrl);
    if (problem) {
      setError(problem);
      return;
    }
    setUrlReady(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!urlReady) {
      continueFromUrl();
      return;
    }
    if (!occupation) {
      setError("Choose one occupation before starting");
      return;
    }
    if (!token && config.mode === "public") {
      setError("Complete human verification before starting");
      return;
    }
    try {
      await onSubmit({
        targetUrl,
        occupationCode: occupation.code,
        turnstileToken: token || "demo-token"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Research could not start");
      if (config.mode === "public") {
        setToken("");
        window.turnstile?.reset();
      }
    }
  }

  return (
    <section className="research-hero" aria-labelledby="research-title">
      <div className="hero-heading">
        <span className="eyebrow">{uiCopy.home.eyebrow}</span>
        <h1 id="research-title">{uiCopy.home.title}</h1>
        <p>{uiCopy.home.description}</p>
      </div>

      <form className="hero-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="target-url">
          {uiCopy.home.urlLabel}
        </label>
        <div className={urlReady ? "url-composer ready" : "url-composer"}>
          <Link2 size={20} aria-hidden="true" />
          <input
            id="target-url"
            type="url"
            inputMode="url"
            autoFocus
            required
            value={targetUrl}
            onChange={(event) => {
              setTargetUrl(event.target.value);
              if (urlReady) {
                setUrlReady(false);
                setOccupation(undefined);
              }
            }}
            placeholder={uiCopy.home.urlPlaceholder}
          />
          {!urlReady && (
            <button className="composer-button" type="button" onClick={continueFromUrl}>
              {uiCopy.home.continue}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          )}
          {urlReady && (
            <button
              className="change-url-button"
              type="button"
              onClick={() => setUrlReady(false)}
            >
              {uiCopy.home.changeUrl}
            </button>
          )}
        </div>

        {urlReady && (
          <div className="occupation-stage">
            <div className="stage-heading">
              <div>
                <span className="stage-number">02</span>
                <h2>{uiCopy.home.occupationLabel}</h2>
              </div>
              <p>{uiCopy.home.occupationHelp}</p>
            </div>
            <div className="input-with-icon occupation-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={occupationInput}
                id="occupation-search"
                value={occupationQuery}
                onChange={(event) => setOccupationQuery(event.target.value)}
                placeholder={uiCopy.home.occupationPlaceholder}
              />
            </div>
            <div className="occupation-list" role="radiogroup" aria-label="Choose one occupation">
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

            {config.mode === "public" && config.turnstileSiteKey && (
              <div className="verification-block">
                <span>Human verification</span>
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
                  <strong>{uiCopy.home.lockedTitle}</strong>
                  <span>{uiCopy.home.lockedBody}</span>
                </div>
                <button className="secondary-button" type="button" onClick={onOpenDemo}>
                  {uiCopy.home.openPilot}
                </button>
              </div>
            ) : (
              <button className="start-button primary-button" type="submit" disabled={busy}>
                {busy ? uiCopy.home.starting : uiCopy.home.start}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="form-error hero-error" role="alert">
            <strong>Check this step</strong>
            <span>{error}</span>
          </div>
        )}
      </form>
    </section>
  );
}
