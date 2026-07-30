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
import { toPng } from "html-to-image";
import { useRef, useState, type ComponentType } from "react";
import { BsOpenai } from "react-icons/bs";
import { SiAnthropic, SiGooglegemini, SiPerplexity } from "react-icons/si";
import {
  buildAskAiLinks,
  buildChatPrompt,
  type AskAiProviderId
} from "../chatPrompt";
import { useLocale } from "../LocaleContext";
import { track } from "../analytics";
import { formatCopy } from "../locales";
import { cleanDisplayTitle, withoutTerminalFullStop } from "../text";
import type {
  DeltaManifestation,
  EvidenceStatus,
  MethodTypeId,
  ReverseReport
} from "../types";
import { EvidenceGraph } from "./EvidenceGraph";
import { GameProfileHero } from "./GameProfileHero";
import { methodTypeLabel } from "./MethodPersona";
import { SharePoster } from "./SharePoster";

const askAiIcons: Record<
  AskAiProviderId,
  ComponentType<{ size?: number; "aria-hidden"?: boolean }>
> = {
  claude: SiAnthropic,
  chatgpt: BsOpenai,
  gemini: SiGooglegemini,
  perplexity: SiPerplexity
};

export function ReportView({
  report,
  onBack
}: {
  report: ReverseReport;
  onBack(): void;
}) {
  const { copy, locale } = useLocale();
  const confidenceLabels: Record<EvidenceStatus, string> = {
    verified: copy.report.verified,
    supported_inference: copy.report.supportedInference,
    plausible: copy.report.plausible,
    unknown_contradicted: copy.report.unknownContradicted
  };
  const deltaLabels: Record<DeltaManifestation, string> = {
    evidenced: copy.report.visible,
    author_specific_extension: copy.report.authorExtension,
    missing_but_expected: copy.report.missingExpected,
    not_observable: copy.report.notObservable,
    contradicted: copy.report.contradicted
  };
  const competencyKindLabels = {
    task: copy.report.task,
    knowledge: copy.report.knowledge,
    skill: copy.report.skill,
    technology: copy.report.technology
  };
  const sourceStatusLabels = {
    verified_at_retrieval: copy.report.verifiedAtRetrieval,
    inherited: copy.report.inherited,
    unverified: copy.report.unverified
  };
  const failureGuides: Record<
    ReverseReport["framework"]["steps"][number]["failureType"],
    { label: string; question: string }
  > = {
    discipline: {
      label: copy.report.disciplineLabel,
      question: copy.report.disciplineQuestion
    },
    shape: { label: copy.report.shapeLabel, question: copy.report.shapeQuestion },
    omission: {
      label: copy.report.omissionLabel,
      question: copy.report.omissionQuestion
    },
    conditional: {
      label: copy.report.conditionalLabel,
      question: copy.report.conditionalQuestion
    }
  };
  const [tab, setTab] = useState<"framework" | "baseline" | "evidence">("framework");
  const [copied, setCopied] = useState(false);
  const [trialContext, setTrialContext] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const posterRef = useRef<HTMLElement>(null);
  const chatPrompt = buildChatPrompt(report, locale);
  const askAiLinks = buildAskAiLinks(report, trialContext, locale);

  async function copyChatPrompt() {
    await navigator.clipboard.writeText(chatPrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function downloadPoster() {
    if (!posterRef.current) return;
    await document.fonts.ready;
    const dataUrl = await toPng(posterRef.current, {
      width: 1080,
      height: 1350,
      canvasWidth: 1080,
      canvasHeight: 1350,
      pixelRatio: 1,
      backgroundColor: "#f7f5ff",
      cacheBust: true
    });
    const link = document.createElement("a");
    link.download = `${report.id === "demo" ? "skill-destiny-demo" : report.id}.png`;
    link.href = dataUrl;
    link.click();
    track("share_completed", {
      share_method: "download",
      report_type: report.id === "demo" ? "demo" : "published"
    });
    setShareNote(copy.game.downloaded);
  }

  async function shareProfile() {
    setShareBusy(true);
    setShareNote("");
    try {
      const response = await fetch(`/api/cards/${encodeURIComponent(report.id)}/share`, {
        method: "POST"
      });
      const body = (await response.json().catch(() => ({}))) as {
        shareUrl?: string;
        error?: { message?: string };
      };
      if (!response.ok || !body.shareUrl) {
        throw new Error(body.error?.message ?? copy.game.shareOpenFailed);
      }
      track("share_created", {
        report_type: report.id === "demo" ? "demo" : "published"
      });
      const highlight = report.gameProfile.axes.find(
        (axis) => axis.id === report.gameProfile.highlightAxisId
      );
      const text = formatCopy(copy.game.shareText, {
        title: report.gameProfile.identity.title,
        type: methodTypeLabel(
          report.gameProfile.identity,
          copy.game.methodTypes as Record<MethodTypeId, string>
        ),
        summary: report.gameProfile.identity.signatureMove,
        axis: copy.game.axes[report.gameProfile.highlightAxisId].label,
        value: highlight?.value ?? copy.game.unknown
      });
      if (navigator.share) {
        await navigator.share({ title: cleanDisplayTitle(report.title), text, url: body.shareUrl });
        track("share_completed", {
          share_method: "native",
          report_type: report.id === "demo" ? "demo" : "published"
        });
        setShareNote(copy.game.shared);
      } else {
        await navigator.clipboard.writeText(`${text}\n${body.shareUrl}`);
        track("share_completed", {
          share_method: "clipboard",
          report_type: report.id === "demo" ? "demo" : "published"
        });
        setShareNote(copy.game.copied);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setShareNote(caught instanceof Error ? caught.message : copy.game.shareFailed);
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <main className="report-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        {copy.report.back}
      </button>

      <GameProfileHero
        report={report}
        onDownload={() => void downloadPoster()}
        onShare={report.viewerCanShare ? () => void shareProfile() : undefined}
        shareBusy={shareBusy}
      />
      {shareNote && (
        <div className="share-note" role="status">
          {shareNote}
        </div>
      )}

      <section className="report-verdict-strip" aria-label={copy.report.currentRecommendation}>
        <span>{copy.report.currentRecommendation}</span>
        <p>{withoutTerminalFullStop(report.verdict)}</p>
        <div className="decision-path" aria-label={copy.report.pathAria}>
          <strong>{copy.report.pathRead}</strong>
          <i aria-hidden="true" />
          <strong>{copy.report.pathTry}</strong>
          <i aria-hidden="true" />
          <strong>{copy.report.pathPackage}</strong>
        </div>
      </section>

      {report.degraded.length > 0 && (
        <div className="report-degraded">
          <TriangleAlert size={20} aria-hidden="true" />
          <div>
            <strong>{copy.report.degradedTitle}</strong>
            <span>
              {report.degraded.map(withoutTerminalFullStop).join(" · ")}
            </span>
          </div>
        </div>
      )}

      <nav className="report-tabs" aria-label={copy.report.tabsAria}>
        <button className={tab === "framework" ? "active" : ""} onClick={() => {
          setTab("framework");
          track("report_section_expanded", { report_type: report.id === "demo" ? "demo" : "published" });
        }}>
          <Fingerprint size={17} aria-hidden="true" />
          {copy.report.frameworkTab}
        </button>
        <button className={tab === "baseline" ? "active" : ""} onClick={() => {
          setTab("baseline");
          track("report_section_expanded", { report_type: report.id === "demo" ? "demo" : "published" });
        }}>
          <BookOpen size={17} aria-hidden="true" />
          {copy.report.baselineTab}
        </button>
        <button className={tab === "evidence" ? "active" : ""} onClick={() => {
          setTab("evidence");
          track("report_section_expanded", { report_type: report.id === "demo" ? "demo" : "published" });
        }}>
          <Network size={17} aria-hidden="true" />
          {copy.report.evidenceTab}
        </button>
      </nav>

      {tab === "framework" && (
        <div className="report-grid">
          <section className="framework-panel">
            <span className="eyebrow">{copy.report.takeaway}</span>
            <h2>{withoutTerminalFullStop(report.framework.name)}</h2>
            <p className="framework-summary">
              {withoutTerminalFullStop(report.framework.summary)}
            </p>
            <div className="when-grid">
              <div>
                <span>{copy.report.useWhen}</span>
                <p>{withoutTerminalFullStop(report.framework.useWhen)}</p>
              </div>
              <div>
                <span>{copy.report.avoidWhen}</span>
                <p>{withoutTerminalFullStop(report.framework.avoidWhen)}</p>
              </div>
            </div>
            <div className="framework-section-heading">
              <div>
                <span className="eyebrow">{copy.report.plainScreen}</span>
                <h3>{copy.report.questionsTitle}</h3>
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
                  <span className="eyebrow">{copy.report.chatEyebrow}</span>
                  <h3 id="chat-trial-title">{copy.report.chatTitle}</h3>
                </div>
                <MessageSquareText size={20} aria-hidden="true" />
              </div>
              <p>{copy.report.chatDescription}</p>
              <label className="chat-context-field">
                <span>
                  {copy.report.yourContext}
                  <small>{copy.report.optional}</small>
                </span>
                <textarea
                  data-clarity-mask="true"
                  value={trialContext}
                  onChange={(event) => setTrialContext(event.target.value)}
                  placeholder={copy.report.contextPlaceholder}
                  maxLength={600}
                  rows={3}
                />
              </label>
              <div className="ask-ai-group">
                <span>{copy.report.askWithCase}</span>
                <div className="ask-ai-links">
                  {askAiLinks.map((link) => {
                    const Icon = askAiIcons[link.id];
                    return (
                      <a
                        key={link.id}
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon size={17} aria-hidden={true} />
                        {link.label}
                      </a>
                    );
                  })}
                </div>
              </div>
              <pre>{chatPrompt}</pre>
              <button className="secondary-button copy-prompt-button" type="button" onClick={copyChatPrompt}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
                {copied ? copy.report.copied : copy.report.copyPrompt}
              </button>
            </section>
          </section>

          <aside className="report-sidebar">
            <section className="adoption-card">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">{copy.report.packagingEyebrow}</span>
                  <h2>{copy.report.packagingTitle}</h2>
                </div>
                <Lightbulb size={19} aria-hidden="true" />
              </div>
              <ol>
                <li><strong>{copy.report.once}</strong><span>{copy.report.onceDetail}</span></li>
                <li><strong>{copy.report.repeated}</strong><span>{copy.report.repeatedDetail}</span></li>
                <li><strong>{copy.report.omitted}</strong><span>{copy.report.omittedDetail}</span></li>
              </ol>
              {report.adoption.length > 0 && (
                <div className="transfer-list">
                  <span>{copy.report.transfer}</span>
                  <ul>
                    {report.adoption.slice(0, 4).map((item) => (
                      <li key={item}>{withoutTerminalFullStop(item)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section className="author-card">
              <span className="eyebrow">{copy.report.authorEyebrow}</span>
              <span className="author-kind">
                {report.author.kind === "person"
                  ? copy.report.creatorPerson
                  : report.author.kind === "organization"
                    ? copy.report.creatorOrganization
                    : report.author.kind === "team"
                      ? copy.report.creatorTeam
                      : copy.report.creatorUnknown}
              </span>
              <h2>{withoutTerminalFullStop(report.author.name)}</h2>
              {report.author.handle && <span className="author-handle">@{report.author.handle}</span>}
              <p>{withoutTerminalFullStop(report.author.background)}</p>
              <strong className="context-heading">{copy.report.contextHeading}</strong>
              <div className="context-note">
                {withoutTerminalFullStop(report.author.context)}
              </div>
            </section>
            <section className="claims-card">
              <div className="section-title-row">
                <h2>{copy.report.claimsTitle}</h2>
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
              <span className="eyebrow">{copy.report.sourceContext}</span>
              <a
                href={report.targetUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("source_link_opened", { report_type: report.id === "demo" ? "demo" : "published" })}
              >
                <span>{new URL(report.targetUrl).hostname}</span>
                <ExternalLink size={15} aria-hidden="true" />
              </a>
              <p>{copy.report.sourceContextBody}</p>
            </section>
          </aside>
        </div>
      )}

      {tab === "baseline" && (
        <div className="baseline-layout">
          <section className="occupation-profile">
            <span className="eyebrow">{copy.report.selectedBaseline}</span>
            <h2>{report.occupation.title}</h2>
            <p>{withoutTerminalFullStop(report.occupation.description)}</p>
            <div className="occupation-source">
              <span>{report.occupation.code}</span>
              <span>O*NET {report.occupation.version}</span>
              <a
                href={report.occupation.sourceUri}
                target="_blank"
                rel="noreferrer"
                onClick={() => track("source_link_opened", { report_type: report.id === "demo" ? "demo" : "published" })}
              >
                {copy.common.source} <ExternalLink size={14} aria-hidden="true" />
              </a>
            </div>
          </section>
          <section className="delta-table" aria-label={copy.report.interpretation}>
            <div className="delta-heading">
              <span>{copy.report.competency}</span>
              <span>{copy.report.result}</span>
              <span>{copy.report.interpretation}</span>
            </div>
            {report.professionalDelta.map((delta) => (
              <article key={delta.competency.label}>
                <div>
                  <span className="competency-kind">
                    {competencyKindLabels[delta.competency.kind]}
                  </span>
                  <strong>{withoutTerminalFullStop(delta.competency.label)}</strong>
                  <small>{copy.report.importance} {delta.competency.importance}</small>
                </div>
                <span className={`delta-state delta-${delta.manifestation}`}>
                  {deltaLabels[delta.manifestation]}
                </span>
                <p>{withoutTerminalFullStop(delta.rationale)}</p>
              </article>
            ))}
          </section>
          <div className="baseline-caution">
            <strong>{copy.report.absenceTitle}</strong>
            <span>{copy.report.absenceBody}</span>
          </div>
        </div>
      )}

      {tab === "evidence" && (
        <div className="evidence-layout">
          <section className="graph-panel">
            <div className="section-title-row">
              <div>
                <span className="eyebrow">{copy.report.traceable}</span>
                <h2>{copy.report.sourceObservationClaim}</h2>
              </div>
              <div className="graph-legend">
                <span><i className="legend-source" /> {copy.common.source}</span>
                <span><i className="legend-observation" /> {copy.report.sourceObservationClaim.split(" → ")[1]}</span>
                <span><i className="legend-claim" /> {copy.report.sourceObservationClaim.split(" → ")[2]}</span>
              </div>
            </div>
            <EvidenceGraph report={report} />
          </section>
          <section className="source-ledger">
            <h2>{copy.report.sourceLedger}</h2>
            {report.sources.map((source, index) => (
              <article className="source-ledger-row" key={source.id}>
                <a
                  className="source-original-link"
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => track("source_link_opened", {
                    report_type: report.id === "demo" ? "demo" : "published"
                  })}
                >
                  <span className="source-number">{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{sourceStatusLabels[source.status]}</small>
                  </span>
                  <ExternalLink size={15} aria-hidden="true" />
                </a>
                {source.archive && (
                  <div className="source-archive-actions" aria-label={`${copy.report.archivedEvidence}: ${source.title}`}>
                    <a href={source.archive.snapshotUrl} target="_blank" rel="noreferrer">
                      <Archive size={14} aria-hidden="true" />
                      {copy.report.savedText}
                    </a>
                    {source.archive.screenshotUrl && (
                      <a href={source.archive.screenshotUrl} target="_blank" rel="noreferrer">
                        <Image size={14} aria-hidden="true" />
                        {copy.report.screenshot}
                      </a>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
          <section className="caveat-list">
            <h2>{copy.report.interpretationLimits}</h2>
            <ul>
              {report.caveats.map((caveat) => (
                <li key={caveat}>{withoutTerminalFullStop(caveat)}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <div className="share-poster-export" aria-hidden="true">
        <SharePoster
          ref={posterRef}
          displayName={cleanDisplayTitle(report.title)}
          occupationTitle={report.occupation.title}
          profile={report.gameProfile}
        />
      </div>
    </main>
  );
}
