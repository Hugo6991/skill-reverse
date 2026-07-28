import { FileSearch2, Plus, ScanSearch } from "lucide-react";
import type { PublicConfig } from "../types";

export type SidebarView = "new" | "pilot" | "report";

export function AppSidebar({
  mode,
  activeView,
  reportTitle,
  onNew,
  onPilot
}: {
  mode: PublicConfig["mode"];
  activeView: SidebarView;
  reportTitle?: string;
  onNew(): void;
  onPilot(): void;
}) {
  return (
    <aside className="app-sidebar">
      <button className="brand" type="button" onClick={onNew} aria-label="Skill Reverse home">
        <span className="brand-mark">
          <ScanSearch size={17} aria-hidden="true" />
        </span>
        <span>Skill Reverse</span>
      </button>

      <nav className="sidebar-nav" aria-label="Workspace">
        <button
          type="button"
          className={activeView === "new" ? "nav-item active" : "nav-item"}
          aria-current={activeView === "new" ? "page" : undefined}
          onClick={onNew}
        >
          <Plus size={16} aria-hidden="true" />
          New reverse
        </button>
        <button
          type="button"
          className={activeView === "pilot" ? "nav-item active" : "nav-item"}
          aria-current={activeView === "pilot" ? "page" : undefined}
          onClick={onPilot}
        >
          <FileSearch2 size={16} aria-hidden="true" />
          Pilot report
        </button>
        {activeView === "report" && (
          <span className="nav-item active current-report" aria-current="page" title={reportTitle}>
            <FileSearch2 size={16} aria-hidden="true" />
            <span>{reportTitle || "Current report"}</span>
          </span>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="header-status">
          <span className={`mode-dot mode-${mode}`} />
          {mode === "locked" ? "Preparing" : mode === "demo" ? "Demo" : "Live"}
        </div>
        <span>O*NET 30.3</span>
      </div>
    </aside>
  );
}
