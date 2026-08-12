import { ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getAnalyticsConsent,
  initializeAnalytics,
  revokeAnalyticsConsent,
  setAnalyticsContext,
  setAnalyticsConsent,
  track,
  type AnalyticsConsent
} from "../analytics";
import { useLocale } from "../LocaleContext";

function PrivacyLink({ onNavigate }: { onNavigate(path: string): void }) {
  const { copy } = useLocale();
  return (
    <a
      className="privacy-notice-link"
      href="/privacy"
      onClick={(event) => {
        event.preventDefault();
        onNavigate("/privacy");
      }}
    >
      {copy.privacy.readNotice}
    </a>
  );
}

export function PrivacyControls({
  open,
  routeKind,
  onOpenChange,
  onNavigate
}: {
  open: boolean;
  routeKind: string;
  onOpenChange(open: boolean): void;
  onNavigate(path: string): void;
}) {
  const { copy, locale } = useLocale();
  const [consent, setConsentState] = useState<AnalyticsConsent>(() => getAnalyticsConsent());

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  function grant() {
    const changed = setAnalyticsConsent("granted");
    const next = getAnalyticsConsent();
    setConsentState(next);
    if (next !== "granted") return;
    if (changed) {
      setAnalyticsContext({ locale, route_kind: routeKind });
      initializeAnalytics();
      track("page_view", { locale, route_kind: routeKind });
    }
    onOpenChange(false);
  }

  function deny() {
    setAnalyticsConsent("denied");
    setConsentState(getAnalyticsConsent());
    onOpenChange(false);
  }

  function revoke() {
    setConsentState("denied");
    revokeAnalyticsConsent();
  }

  const status =
    consent === "granted"
      ? copy.privacy.statusGranted
      : consent === "denied"
        ? copy.privacy.statusDenied
        : copy.privacy.statusUnknown;

  return (
    <>
      {consent === "unknown" && !open && (
        <section className="consent-banner" aria-labelledby="consent-title">
          <div className="consent-banner-copy">
            <span className="eyebrow">{copy.privacy.bannerEyebrow}</span>
            <strong id="consent-title">{copy.privacy.bannerTitle}</strong>
            <p>{copy.privacy.bannerBody}</p>
            <PrivacyLink onNavigate={onNavigate} />
          </div>
          <div className="consent-banner-actions">
            <button className="consent-choice-button" type="button" onClick={deny}>
              {copy.privacy.decline}
            </button>
            <button className="consent-choice-button" type="button" onClick={grant}>
              {copy.privacy.accept}
            </button>
          </div>
        </section>
      )}

      {open && (
        <section
          className="privacy-settings-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="privacy-settings-title"
        >
          <div className="privacy-settings-heading">
            <span className="privacy-settings-mark">
              <ShieldCheck size={17} aria-hidden="true" />
            </span>
            <div>
              <span className="eyebrow">{copy.privacy.settingsEyebrow}</span>
              <strong id="privacy-settings-title">{copy.privacy.settingsTitle}</strong>
            </div>
            <button
              className="privacy-settings-close"
              type="button"
              aria-label={copy.privacy.close}
              onClick={() => onOpenChange(false)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <p>{copy.privacy.settingsBody}</p>
          <div className="privacy-status-row">
            <span>{copy.privacy.statusLabel}</span>
            <strong data-consent={consent}>{status}</strong>
          </div>
          <div className="privacy-settings-actions">
            {consent === "granted" ? (
              <button className="consent-choice-button" type="button" onClick={revoke}>
                {copy.privacy.withdraw}
              </button>
            ) : (
              <button className="consent-choice-button" type="button" onClick={grant}>
                {copy.privacy.enable}
              </button>
            )}
            {consent === "unknown" && (
              <button className="consent-choice-button" type="button" onClick={deny}>
                {copy.privacy.decline}
              </button>
            )}
          </div>
          <PrivacyLink
            onNavigate={(path) => {
              onOpenChange(false);
              onNavigate(path);
            }}
          />
        </section>
      )}
    </>
  );
}
