import {
  ArrowUpRight,
  BadgeCheck,
  ImageDown,
  ScrollText,
  Share2,
  UserRound
} from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import { useLocale } from "../LocaleContext";
import { formatCopy } from "../locales";
import { cleanDisplayTitle, withoutTerminalFullStop } from "../text";
import type { GameAxisId, ReverseReport } from "../types";
import { GameAxisList, GameRadar } from "./GameRadar";
import { GameIdentityMark } from "./GameIdentityMark";

export const GameProfileHero = forwardRef<
  HTMLElement,
  {
    report: ReverseReport;
    onShare?(): void;
    onDownload?(): void;
    shareBusy?: boolean;
  }
>(function GameProfileHero({ report, onShare, onDownload, shareBusy }, ref) {
  const { copy, locale } = useLocale();
  const profile = report.gameProfile;
  const [selectedAxisId, setSelectedAxisId] = useState<GameAxisId>(
    profile.highlightAxisId
  );
  const [avatarFailed, setAvatarFailed] = useState(false);
  const selectedAxis = useMemo(
    () => profile.axes.find((axis) => axis.id === selectedAxisId) ?? profile.axes[0],
    [profile.axes, selectedAxisId]
  );
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  const observationById = new Map(report.observations.map((item) => [item.id, item]));
  const claimById = new Map(report.claims.map((claim) => [claim.id, claim]));
  const signalCopy = copy.game.signals as Record<string, string>;
  const signalLabel = (id: string, value?: number) => {
    const base = signalCopy[id] ?? id;
    if (value === undefined) return base;
    if (id === "github_stars" || id === "github_forks") {
      return `${base} ${new Intl.NumberFormat(locale, { notation: "compact" }).format(value)}`;
    }
    if (id === "public_discussion") return `${base} ${value}`;
    if (id === "maintenance_recency") {
      return locale === "zh-TW" ? `${base} ${value} 天前` : `${base} ${value} days ago`;
    }
    return base;
  };

  return (
    <section
      className={`destiny-card motif-${profile.identity.motifId}`}
      data-axis={profile.highlightAxisId}
      data-accent={profile.accentAxisId}
      ref={ref}
      aria-labelledby="destiny-title"
    >
      <div className="destiny-sky" aria-hidden="true" />
      <header className="destiny-card-header">
        <div>
          <span className="destiny-kicker">{copy.game.kicker} · {profile.rubricVersion}</span>
          <span>{new Date(report.generatedAt).toLocaleDateString(locale)}</span>
        </div>
        <div className="destiny-actions" data-export-hide="true">
          {onDownload && (
            <button type="button" onClick={onDownload}>
              <ImageDown size={15} aria-hidden="true" />
              {copy.game.download}
            </button>
          )}
          {onShare && (
            <button type="button" onClick={onShare} disabled={shareBusy}>
              <Share2 size={15} aria-hidden="true" />
              {shareBusy ? copy.game.opening : copy.game.share}
            </button>
          )}
        </div>
      </header>

      <div className="destiny-stage">
        <aside className="destiny-identity">
          <div className="destiny-avatar">
            {profile.author.avatarUrl && !avatarFailed ? (
              <img
                src={profile.author.avatarUrl}
                alt=""
                crossOrigin="anonymous"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <UserRound size={32} aria-hidden="true" />
            )}
          </div>
          <span className="destiny-attribution">
            {copy.game.attribution[profile.author.attribution]}
          </span>
          <h1 id="destiny-title">{cleanDisplayTitle(report.title)}</h1>
          <strong>{withoutTerminalFullStop(report.author.name)}</strong>
          {profile.author.profileUrl && (
            <a href={profile.author.profileUrl} target="_blank" rel="noreferrer">
              {copy.game.viewIdentity}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </aside>

        <div className="destiny-chart">
          <div className="destiny-seal">
            <GameIdentityMark motifId={profile.identity.motifId} size={20} label={false} />
            <strong>{profile.identity.title}</strong>
          </div>
          <GameRadar axes={profile.axes} accentAxisId={profile.highlightAxisId} />
          <GameAxisList
            axes={profile.axes}
            selected={selectedAxisId}
            onSelect={setSelectedAxisId}
          />
        </div>

        <aside className="destiny-reading">
          <blockquote>{profile.identity.oneLiner}</blockquote>
          <dl>
            <div>
              <dt>{copy.game.highlight}</dt>
              <dd>{copy.game.axes[profile.highlightAxisId].label}</dd>
            </div>
            <div>
              <dt>{copy.game.risk}</dt>
              <dd>{copy.game.axes[profile.riskAxisId].label}</dd>
            </div>
          </dl>
          <div className="identity-traits" aria-label={copy.game.traitsLabel}>
            {profile.identity.traits.map((trait) => <span key={trait}>{trait}</span>)}
          </div>
          <div className="destiny-badges" aria-label={copy.game.badgesLabel}>
            {profile.badges.length > 0 ? (
              profile.badges.map((badge) => (
                <span key={badge}>
                  <BadgeCheck size={14} aria-hidden="true" />
                  {copy.game.badges[badge]}
                </span>
              ))
            ) : (
              <span>
                <ScrollText size={14} aria-hidden="true" />
                {copy.game.noClues}
              </span>
            )}
          </div>
          <div className="identity-evidence" data-export-hide="true">
            {profile.identity.evidenceUrls.slice(0, 2).map((url, index) => (
              <a href={url} target="_blank" rel="noreferrer" key={url}>
                {formatCopy(copy.game.evidence, { number: index + 1 })}
                <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            ))}
          </div>
        </aside>
      </div>

      <div className="destiny-axis-detail" aria-live="polite">
        <div>
          <span>{copy.game.axes[selectedAxis.id].label}</span>
          <strong>{selectedAxis.value ?? copy.game.unknown}</strong>
          <small>{formatCopy(copy.game.coverage, { value: selectedAxis.coverage })}</small>
        </div>
        <p>{copy.game.axes[selectedAxis.id].description}</p>
        <ul>
          {selectedAxis.signalDetails?.length
            ? selectedAxis.signalDetails.map((signal) => (
                <li className="destiny-scored-signal" key={signal.id}>
                  <span>{signalLabel(signal.id, signal.value)}</span>
                  <small>
                    +{signal.points} / {signal.maxPoints}
                  </small>
                </li>
              ))
            : selectedAxis.signalIds.slice(0, 3).map((signalId) => (
                <li key={signalId}>{signalCopy[signalId] ?? signalId}</li>
              ))}
          {selectedAxis.evidenceIds.slice(0, 2).map((evidenceId) => {
            const evidence =
              sourceById.get(evidenceId)?.title ??
              observationById.get(evidenceId)?.text ??
              claimById.get(evidenceId)?.text;
            return evidence ? <li key={evidenceId}>{withoutTerminalFullStop(evidence)}</li> : null;
          })}
        </ul>
        {selectedAxis.id === "money" && (
          <span className="destiny-money-note">{copy.game.moneyNote}</span>
        )}
      </div>
    </section>
  );
});
