import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render(
        target: string | HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback(token: string): void;
          "expired-callback"(): void;
          "error-callback"(): void;
        }
      ): string;
      reset(widgetId?: string): void;
      remove(widgetId: string): void;
    };
  }
}

let scriptPromise: Promise<void> | undefined;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile could not be loaded"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({
  siteKey,
  action = "create_research_job",
  onToken,
  onError
}: {
  siteKey: string;
  action?: string;
  onToken(token: string): void;
  onError(message: string): void;
}) {
  const reactId = useId();
  const elementId = `turnstile-${reactId.replaceAll(":", "")}`;
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!siteKey) return;
    let active = true;
    loadTurnstile()
      .then(() => {
        if (!active || !window.turnstile) return;
        widgetId.current = window.turnstile.render(`#${elementId}`, {
          sitekey: siteKey,
          action,
          theme: "light",
          size: "flexible",
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onError("Human verification could not load")
        });
      })
      .catch((error) => onError(error instanceof Error ? error.message : "Turnstile failed"));
    return () => {
      active = false;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, [action, elementId, onError, onToken, siteKey]);

  return <div className="turnstile-shell" id={elementId} aria-label="Human verification" />;
}
