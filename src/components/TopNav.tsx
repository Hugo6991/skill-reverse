import {
  BookMarked,
  FileSearch2,
  Globe2,
  Plus,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { useLocale } from "../LocaleContext";

export type AppRoute =
  | { kind: "home" }
  | { kind: "admin" }
  | { kind: "privacy" }
  | { kind: "history" }
  | { kind: "collection" }
  | { kind: "job"; id: string }
  | { kind: "report"; id: string }
  | { kind: "public_card"; slug: string }
  | { kind: "not_found" };

function NavLink({
  href,
  active,
  children,
  onNavigate
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  onNavigate(path: string): void;
}) {
  return (
    <a
      href={href}
      className={active ? "top-nav-link active" : "top-nav-link"}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

export function TopNav({
  route,
  onNavigate,
  onOpenPrivacySettings
}: {
  route: AppRoute;
  onNavigate(path: string): void;
  onOpenPrivacySettings(): void;
}) {
  const { copy, locale, setLocale } = useLocale();
  return (
    <header className="top-nav">
      <div className="top-nav-inner">
        <a
          className="top-brand"
          href="/"
          aria-label={copy.nav.homeLabel}
          onClick={(event) => {
            event.preventDefault();
            onNavigate("/");
          }}
        >
          <span className="brand-mark">
            <ScanSearch size={17} aria-hidden="true" />
          </span>
          <span>Skill Reverse</span>
        </a>

        <nav className="top-nav-links" aria-label={copy.nav.primaryLabel}>
          <NavLink href="/" active={route.kind === "home"} onNavigate={onNavigate}>
            <Plus size={15} aria-hidden="true" />
            {copy.nav.newReverse}
          </NavLink>
          <NavLink
            href="/history"
            active={route.kind === "history"}
            onNavigate={onNavigate}
          >
            <Globe2 size={15} aria-hidden="true" />
            {copy.nav.history}
          </NavLink>
          <NavLink
            href="/collection"
            active={route.kind === "collection" || route.kind === "job"}
            onNavigate={onNavigate}
          >
            <BookMarked size={15} aria-hidden="true" />
            {copy.nav.collection}
          </NavLink>
          <NavLink
            href="/reports/demo"
            active={route.kind === "report" && route.id === "demo"}
            onNavigate={onNavigate}
          >
            <FileSearch2 size={15} aria-hidden="true" />
            {copy.nav.pilot}
          </NavLink>
          {route.kind === "admin" && (
            <NavLink href="/admin" active onNavigate={onNavigate}>
              <ShieldCheck size={15} aria-hidden="true" />
              {copy.common.owner}
            </NavLink>
          )}
        </nav>
        <div className="locale-switcher" role="group" aria-label={copy.nav.languageLabel}>
          <button
            type="button"
            aria-pressed={locale === "zh-TW"}
            className={locale === "zh-TW" ? "active" : undefined}
            onClick={() => setLocale("zh-TW")}
          >
            {copy.nav.chinese}
          </button>
          <button
            type="button"
            aria-pressed={locale === "en"}
            className={locale === "en" ? "active" : undefined}
            onClick={() => setLocale("en")}
          >
            {copy.nav.english}
          </button>
        </div>
        <button
          className="privacy-nav-button"
          type="button"
          aria-label={copy.privacy.navSettings}
          title={copy.privacy.navSettings}
          onClick={onOpenPrivacySettings}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>{copy.privacy.navSettings}</span>
        </button>
      </div>
    </header>
  );
}
