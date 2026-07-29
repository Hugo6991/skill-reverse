import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode
} from "react";
import type { Locale } from "./types";
import { en, isLocale, zhTW, type TranslationSchema } from "./locales";

const STORAGE_KEY = "skill-reverse:locale";
const dictionaries: Record<Locale, TranslationSchema> = { "zh-TW": zhTW, en };

export function resolveInitialLocale({
  search, stored, browserLanguage
}: {
  search: string; stored?: string | null; browserLanguage?: string;
}): Locale {
  const requested = new URLSearchParams(search).get("lang");
  if (isLocale(requested)) return requested;
  if (isLocale(stored)) return stored;
  if (browserLanguage?.toLowerCase().startsWith("zh")) return "zh-TW";
  if (browserLanguage?.toLowerCase().startsWith("en")) return "en";
  return "zh-TW";
}

interface LocaleContextValue {
  locale: Locale;
  copy: TranslationSchema;
  setLocale(locale: Locale): void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveInitialLocale({
      search: window.location.search,
      stored: window.localStorage.getItem(STORAGE_KEY),
      browserLanguage: window.navigator.language
    })
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const onPopState = () => {
      const requested = new URLSearchParams(window.location.search).get("lang");
      if (isLocale(requested)) {
        setLocaleState(requested);
        window.localStorage.setItem(STORAGE_KEY, requested);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const value = useMemo(() => ({ locale, copy: dictionaries[locale], setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
