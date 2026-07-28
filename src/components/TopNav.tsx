import {
  BookMarked,
  FileSearch2,
  Globe2,
  Plus,
  ScanSearch,
  ShieldCheck
} from "lucide-react";
import { uiCopy } from "../copy";

export type AppRoute =
  | { kind: "home" }
  | { kind: "admin" }
  | { kind: "history" }
  | { kind: "collection" }
  | { kind: "job"; id: string }
  | { kind: "report"; id: string }
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
  onNavigate
}: {
  route: AppRoute;
  onNavigate(path: string): void;
}) {
  return (
    <header className="top-nav">
      <div className="top-nav-inner">
        <a
          className="top-brand"
          href="/"
          aria-label="Skill Reverse home"
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

        <nav className="top-nav-links" aria-label="Primary navigation">
          <NavLink href="/" active={route.kind === "home"} onNavigate={onNavigate}>
            <Plus size={15} aria-hidden="true" />
            {uiCopy.nav.newReverse}
          </NavLink>
          <NavLink
            href="/history"
            active={route.kind === "history"}
            onNavigate={onNavigate}
          >
            <Globe2 size={15} aria-hidden="true" />
            {uiCopy.nav.history}
          </NavLink>
          <NavLink
            href="/collection"
            active={route.kind === "collection" || route.kind === "job"}
            onNavigate={onNavigate}
          >
            <BookMarked size={15} aria-hidden="true" />
            藏經閣
          </NavLink>
          <NavLink
            href="/reports/demo"
            active={route.kind === "report" && route.id === "demo"}
            onNavigate={onNavigate}
          >
            <FileSearch2 size={15} aria-hidden="true" />
            {uiCopy.nav.pilot}
          </NavLink>
          {route.kind === "admin" && (
            <NavLink href="/admin" active onNavigate={onNavigate}>
              <ShieldCheck size={15} aria-hidden="true" />
              Owner
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}
