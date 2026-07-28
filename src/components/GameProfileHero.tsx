import {
  ArrowUpRight,
  BadgeCheck,
  ImageDown,
  ScrollText,
  Share2,
  Sparkles,
  UserRound
} from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import {
  attributionCopy,
  gameArchetypeCopy,
  gameAxisCopy,
  gameBadgeCopy,
  gameRoastCopy,
  gameSignalLabel,
  gameSignalCopy
} from "../game-copy";
import { cleanDisplayTitle, withoutTerminalFullStop } from "../text";
import type { GameAxisId, ReverseReport } from "../types";
import { GameAxisList, GameRadar } from "./GameRadar";

export const GameProfileHero = forwardRef<
  HTMLElement,
  {
    report: ReverseReport;
    onShare?(): void;
    onDownload?(): void;
    shareBusy?: boolean;
  }
>(function GameProfileHero({ report, onShare, onDownload, shareBusy }, ref) {
  const profile = report.gameProfile;
  const [selectedAxisId, setSelectedAxisId] = useState<GameAxisId>(
    profile.strongestAxisId
  );
  const [avatarFailed, setAvatarFailed] = useState(false);
  const selectedAxis = useMemo(
    () => profile.axes.find((axis) => axis.id === selectedAxisId) ?? profile.axes[0],
    [profile.axes, selectedAxisId]
  );
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  const observationById = new Map(report.observations.map((item) => [item.id, item]));
  const claimById = new Map(report.claims.map((claim) => [claim.id, claim]));

  return (
    <section className="destiny-card" ref={ref} aria-labelledby="destiny-title">
      <div className="destiny-sky" aria-hidden="true" />
      <header className="destiny-card-header">
        <div>
          <span className="destiny-kicker">秘籍鑑定 · {profile.rubricVersion}</span>
          <span>{new Date(report.generatedAt).toLocaleDateString("zh-TW")}</span>
        </div>
        <div className="destiny-actions" data-export-hide="true">
          {onDownload && (
            <button type="button" onClick={onDownload}>
              <ImageDown size={15} aria-hidden="true" />
              下載畫像卡
            </button>
          )}
          {onShare && (
            <button type="button" onClick={onShare} disabled={shareBusy}>
              <Share2 size={15} aria-hidden="true" />
              {shareBusy ? "開啟中" : "分享畫像"}
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
            {attributionCopy[profile.author.attribution]}
          </span>
          <h1 id="destiny-title">{cleanDisplayTitle(report.title)}</h1>
          <strong>{withoutTerminalFullStop(report.author.name)}</strong>
          {profile.author.profileUrl && (
            <a href={profile.author.profileUrl} target="_blank" rel="noreferrer">
              查看來源身份
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </aside>

        <div className="destiny-chart">
          <div className="destiny-seal">
            <Sparkles size={15} aria-hidden="true" />
            <strong>{gameArchetypeCopy[profile.archetypeId]}</strong>
          </div>
          <GameRadar axes={profile.axes} />
          <GameAxisList
            axes={profile.axes}
            selected={selectedAxisId}
            onSelect={setSelectedAxisId}
          />
        </div>

        <aside className="destiny-reading">
          <blockquote>{gameRoastCopy[profile.roastId]}</blockquote>
          <dl>
            <div>
              <dt>最強天賦</dt>
              <dd>{gameAxisCopy[profile.strongestAxisId].label}</dd>
            </div>
            <div>
              <dt>最大罩門</dt>
              <dd>{gameAxisCopy[profile.weakestAxisId].label}</dd>
            </div>
          </dl>
          <div className="destiny-badges" aria-label="事實徽章">
            {profile.badges.length > 0 ? (
              profile.badges.map((badge) => (
                <span key={badge}>
                  <BadgeCheck size={14} aria-hidden="true" />
                  {gameBadgeCopy[badge]}
                </span>
              ))
            ) : (
              <span>
                <ScrollText size={14} aria-hidden="true" />
                待補線索
              </span>
            )}
          </div>
        </aside>
      </div>

      <div className="destiny-axis-detail" aria-live="polite">
        <div>
          <span>{gameAxisCopy[selectedAxis.id].label}</span>
          <strong>{selectedAxis.value ?? "未知"}</strong>
          <small>資料覆蓋 {selectedAxis.coverage}%</small>
        </div>
        <p>{gameAxisCopy[selectedAxis.id].description}</p>
        <ul>
          {selectedAxis.signalDetails?.length
            ? selectedAxis.signalDetails.map((signal) => (
                <li className="destiny-scored-signal" key={signal.id}>
                  <span>{gameSignalLabel(signal.id, signal.value)}</span>
                  <small>
                    +{signal.points} / {signal.maxPoints}
                  </small>
                </li>
              ))
            : selectedAxis.signalIds.slice(0, 3).map((signalId) => (
                <li key={signalId}>{gameSignalCopy[signalId] ?? signalId}</li>
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
          <span className="destiny-money-note">只看使用者獲利潛力 不構成收益承諾</span>
        )}
      </div>
    </section>
  );
});
