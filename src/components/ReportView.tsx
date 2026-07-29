import {
  ArrowLeft,
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  CircleDashed,
  Clipboard,
  Compass,
  ExternalLink,
  Fingerprint,
  Lightbulb,
  Image,
  MessageSquareText,
  Network,
  ShieldCheck,
  TriangleAlert
} from "lucide-react";
import { useState } from "react";
import { buildChatPrompt } from "../chatPrompt";
import { withoutTerminalFullStop } from "../text";
import type { DeltaManifestation, EvidenceStatus, ReverseReport } from "../types";
import { EvidenceGraph } from "./EvidenceGraph";

const confidenceLabels: Record<EvidenceStatus, string> = {
  verified: "Verified",
  supported_inference: "Supported inference",
  plausible: "Plausible",
  unknown_contradicted: "Unknown / contradicted"
};

const deltaLabels: Record<DeltaManifestation, string> = {
  evidenced: "Visible in result",
  author_specific_extension: "Author-specific extension",
  missing_but_expected: "Missing but expected",
  not_observable: "Not observable",
  contradicted: "Contradicted"
};

const failureGuides: Record<
  ReverseReport["framework"]["steps"][number]["failureType"],
  { label: string; question: string }
> = {
  discipline: {
    label: "容易跳過",
    question: "哪個步驟一忙、一趕或交給 AI 後，最容易被省略？"
  },
  shape: {
    label: "輸出走樣",
    question: "如果結果看似完成卻不好用，理想輸出應該長什麼樣？"
  },
  omission: {
    label: "關鍵遺漏",
    question: "少了哪個必要資訊，整個判斷就不再可靠？"
  },
  conditional: {
    label: "條件改變",
    question: "什麼條件一變，做法也必須跟著改？"
  }
};

export function ReportView({
  report,
  onBack
}: {
  report: ReverseReport;
  onBack(): void;
}) {
  const [tab, setTab] = useState<"framework" | "baseline" | "evidence">("framework");
  const [copied, setCopied] = useState(false);
  const chatPrompt = buildChatPrompt(report);

  async function copyChatPrompt() {
    await navigator.clipboard.writeText(chatPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="report-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        New docket
      </button>

      <header className="report-hero">
        <div className="report-kicker">
          <span>Decision brief · 先理解，再決定要不要採用</span>
          <span>{new Date(report.generatedAt).toLocaleDateString("zh-TW")}</span>
        </div>
        <h1>{withoutTerminalFullStop(report.title)}</h1>
        <div className="decision-verdict">
          <span className="decision-label">目前建議</span>
          <p>{withoutTerminalFullStop(report.verdict)}</p>
        </div>
        <div className="decision-path" aria-label="Recommended adoption path">
          <span className="active">讀懂思維</span>
          <i aria-hidden="true" />
          <span>丟進 Chat 試一次</span>
          <i aria-hidden="true" />
          <span>反覆需要時才封裝</span>
        </div>
      </header>

      {report.degraded.length > 0 && (
        <div className="report-degraded">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <strong>Some evidence lanes were unavailable</strong>
            <span>
              {report.degraded.map(withoutTerminalFullStop).join(" · ")}
            </span>
          </div>
        </div>
      )}

      <nav className="report-tabs" aria-label="Report sections">
        <button className={tab === "framework" ? "active" : ""} onClick={() => setTab("framework")}>
          <Fingerprint size={17} aria-hidden="true" />
          思考與試用
        </button>
        <button className={tab === "baseline" ? "active" : ""} onClick={() => setTab("baseline")}>
          <BookOpen size={17} aria-hidden="true" />
          應用場景
        </button>
        <button className={tab === "evidence" ? "active" : ""} onClick={() => setTab("evidence")}>
          <Network size={17} aria-hidden="true" />
          證據與來源
        </button>
      </nav>

      {tab === "framework" && (
        <div className="report-grid">
          <section className="framework-panel">
            <span className="eyebrow">你真正要帶走的東西</span>
            <h2>{withoutTerminalFullStop(report.framework.name)}</h2>
            <p className="framework-summary">
              {withoutTerminalFullStop(report.framework.summary)}
            </p>
            <div className="when-grid">
              <div>
                <span>這時值得用</span>
                <p>{withoutTerminalFullStop(report.framework.useWhen)}</p>
              </div>
              <div>
                <span>這時先別用</span>
                <p>{withoutTerminalFullStop(report.framework.avoidWhen)}</p>
              </div>
            </div>
            <div className="framework-section-heading">
              <div>
                <span className="eyebrow">白話初篩</span>
                <h3>先問這些問題，不必先安裝任何東西</h3>
              </div>
              <Compass size={20} aria-hidden="true" />
            </div>
            <ol className="framework-steps">
              {report.framework.steps.map((step, index) => (
                <li key={`${step.title}-${index}`}>
                  <span className="framework-index">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <span className={`failure-tag failure-${step.failureType}`}>
                      {failureGuides[step.failureType].label}
                    </span>
                    <h3>{withoutTerminalFullStop(step.title)}</h3>
                    <strong className="framework-question">
                      {failureGuides[step.failureType].question}
                    </strong>
                    <p>{withoutTerminalFullStop(step.instruction)}</p>
                  </div>
                </li>
              ))}
            </ol>

            <section className="chat-trial" aria-labelledby="chat-trial-title">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">任何 AI 都能先試</span>
                  <h3 id="chat-trial-title">先讀既有脈絡，再直接交付第一版</h3>
                </div>
                <MessageSquareText size={20} aria-hidden="true" />
              </div>
              <p>
                這段提示會要求 AI 先使用可取得的對話、記憶與既有產出，直接交付完整 v1；
                只有會改變方向的阻塞問題才能放在結果後，最多三題
              </p>
              <pre>{chatPrompt}</pre>
              <button className="secondary-button copy-prompt-button" type="button" onClick={copyChatPrompt}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
                {copied ? "已複製" : "複製試跑文字"}
              </button>
            </section>
          </section>

          <aside className="report-sidebar">
            <section className="adoption-card">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">從收藏改成判斷</span>
                  <h2>什麼時候才需要封裝？</h2>
                </div>
                <Lightbulb size={19} aria-hidden="true" />
              </div>
              <ol>
                <li><strong>只用一次</strong><span>留成一段 prompt 或筆記就夠</span></li>
                <li><strong>反覆用到</strong><span>再整理成可重複的 Chat 指令</span></li>
                <li><strong>步驟常被漏掉</strong><span>這時才值得做成 skill 或 agent</span></li>
              </ol>
              {report.adoption.length > 0 && (
                <div className="transfer-list">
                  <span>本案例可直接帶走</span>
                  <ul>
                    {report.adoption.slice(0, 4).map((item) => (
                      <li key={item}>{withoutTerminalFullStop(item)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="author-card">
              <span className="eyebrow">創作者脈絡 · 不是權威背書</span>
              <h2>{withoutTerminalFullStop(report.author.name)}</h2>
              {report.author.handle && <span className="author-handle">@{report.author.handle}</span>}
              <p>{withoutTerminalFullStop(report.author.background)}</p>
              <strong className="context-heading">這套方法為什麼會形成</strong>
              <div className="context-note">
                {withoutTerminalFullStop(report.author.context)}
              </div>
            </section>
            <section className="claims-card">
              <div className="section-title-row">
                <h2>目前哪些判斷站得住腳</h2>
                <ShieldCheck size={19} aria-hidden="true" />
              </div>
              <div className="claim-list">
                {report.claims.map((claim) => (
                  <article key={claim.id}>
                    <div className="claim-state">
                      {claim.status === "verified" ? (
                        <CheckCircle2 size={15} aria-hidden="true" />
                      ) : (
                        <CircleDashed size={15} aria-hidden="true" />
                      )}
                      <span>{confidenceLabels[claim.status]}</span>
                      <strong>{claim.confidence}</strong>
                    </div>
                    <p>{withoutTerminalFullStop(claim.text)}</p>
                  </article>
                ))}
              </div>
            </section>
            <section className="source-context-card">
              <span className="eyebrow">案例來源 · 不是主角</span>
              <a href={report.targetUrl} target="_blank" rel="noreferrer">
                <span>{new URL(report.targetUrl).hostname}</span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
              <p>
                這個來源只用來追溯本次判斷；你不需要先認識創作者，也不需要下載內容，才能使用上面的框架
              </p>
            </section>
          </aside>
        </div>
      )}

      {tab === "baseline" && (
        <div className="baseline-layout">
          <section className="occupation-profile">
            <span className="eyebrow">Selected baseline</span>
            <h2>{report.occupation.title}</h2>
            <p>{withoutTerminalFullStop(report.occupation.description)}</p>
            <div className="occupation-source">
              <span>{report.occupation.code}</span>
              <span>O*NET {report.occupation.version}</span>
              <a href={report.occupation.sourceUri} target="_blank" rel="noreferrer">
                Source <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </section>
          <section className="delta-table" aria-label="Professional competency comparison">
            <div className="delta-heading">
              <span>Competency</span>
              <span>Result</span>
              <span>Evidence-aware interpretation</span>
            </div>
            {report.professionalDelta.map((delta) => (
              <article key={delta.competency.label}>
                <div>
                  <span className="competency-kind">{delta.competency.kind}</span>
                  <strong>{withoutTerminalFullStop(delta.competency.label)}</strong>
                  <small>Importance {delta.competency.importance}</small>
                </div>
                <span className={`delta-state delta-${delta.manifestation}`}>
                  {deltaLabels[delta.manifestation]}
                </span>
                <p>{withoutTerminalFullStop(delta.rationale)}</p>
              </article>
            ))}
          </section>
          <div className="baseline-caution">
            <strong>Absence of evidence is not evidence of absence</strong>
            <span>這張表描述成果能證明什麼，不用來評斷作者具不具備某項能力</span>
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <div className="evidence-layout">
          <section className="graph-panel">
            <div className="section-title-row">
              <div>
                <span className="eyebrow">Traceable reasoning</span>
                <h2>Source → observation → claim</h2>
              </div>
              <div className="graph-legend">
                <span><i className="legend-source" /> Source</span>
                <span><i className="legend-observation" /> Observation</span>
                <span><i className="legend-claim" /> Claim</span>
              </div>
            </div>
            <EvidenceGraph report={report} />
          </section>
          <section className="source-ledger">
            <h2>Source ledger</h2>
            {report.sources.map((source, index) => (
              <article className="source-ledger-row" key={source.id}>
                <a
                  className="source-original-link"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="source-number">{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{source.status.replaceAll("_", " ")}</small>
                  </span>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
                {source.archive && (
                  <div className="source-archive-actions" aria-label={`Archived evidence for ${source.title}`}>
                    <a href={source.archive.snapshotUrl} target="_blank" rel="noreferrer">
                      <Archive size={14} aria-hidden="true" />
                      Saved text
                    </a>
                    {source.archive.screenshotUrl && (
                      <a href={source.archive.screenshotUrl} target="_blank" rel="noreferrer">
                        <Image size={14} aria-hidden="true" />
                        Screenshot
                      </a>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
          <section className="caveat-list">
            <h2>Interpretation limits</h2>
            <ul>
              {report.caveats.map((caveat) => (
                <li key={caveat}>{withoutTerminalFullStop(caveat)}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
