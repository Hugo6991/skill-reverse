import {
  ArrowRight,
  BookMarked,
  LoaderCircle,
  Share2,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../LocaleContext";
import { track } from "../analytics";
import { formatCopy } from "../locales";
import type {
  CollectionPage as CollectionResponse,
  MyResearchItem,
  SkillCardSummary
} from "../types";
import { GameRadar } from "./GameRadar";
import { GameIdentityMark } from "./GameIdentityMark";
import { MethodTypeLockup, PersonaBeats } from "./MethodPersona";

async function loadCollection(locale: "zh-TW" | "en", errorMessage: string): Promise<CollectionResponse> {
  const response = await fetch(`/api/collection?lang=${encodeURIComponent(locale)}`);
  const body = (await response.json().catch(() => ({}))) as CollectionResponse & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? errorMessage);
  return body;
}

function volumeNumber(index: number): string {
  const numbers = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (index < 10) return numbers[index];
  if (index === 10) return "十";
  if (index < 20) return `十${numbers[index - 10]}`;
  const tens = Math.floor(index / 10);
  const ones = index % 10;
  return `${numbers[tens]}十${ones ? numbers[ones] : ""}`;
}

export function CollectionPage({ onNavigate }: { onNavigate(path: string): void }) {
  const { copy, locale } = useLocale();
  const [cards, setCards] = useState<SkillCardSummary[]>([]);
  const [activity, setActivity] = useState<MyResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await loadCollection(locale, copy.collection.loadFailed);
      setCards(next.cards);
      setActivity(next.activity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : copy.collection.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [copy.collection.loadFailed, locale]);

  useEffect(() => {
    track("collection_viewed", { route_kind: "collection" });
    void refresh();
  }, [refresh]);

  async function removeCard(card: SkillCardSummary) {
    if (!window.confirm(formatCopy(copy.collection.removeConfirm, { name: card.displayName }))) {
      return;
    }
    const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? copy.collection.removeFailed);
      return;
    }
    setCards((current) => current.filter((candidate) => candidate.id !== card.id));
    track("card_removed", { route_kind: "collection" });
  }

  return (
    <main className="page-frame collection-page" data-clarity-mask="true">
      <header className="page-heading collection-heading">
        <span className="eyebrow">{copy.collection.eyebrow}</span>
        <h1>{copy.collection.title}</h1>
        <p>{copy.collection.description}</p>
      </header>

      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <span>{copy.collection.loading}</span>
        </div>
      ) : error ? (
        <div className="page-state error-state" role="alert">
          <strong>{copy.collection.loadFailed}</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            {copy.collection.retry}
          </button>
        </div>
      ) : cards.length === 0 && activity.length === 0 ? (
        <div className="page-state collection-empty">
          <span className="empty-icon">
            <BookMarked size={22} aria-hidden="true" />
          </span>
          <strong>{copy.collection.emptyTitle}</strong>
          <span>{copy.collection.emptyBody}</span>
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            {copy.collection.emptyAction}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          {cards.length > 0 && (
            <section className="collection-grid" aria-label={copy.collection.cardsLabel}>
              {cards.map((card, index) => (
                <article
                  className={`manual-card motif-${card.gameProfile.identity.motifId}`}
                  data-axis={card.gameProfile.highlightAxisId}
                  data-accent={card.gameProfile.accentAxisId}
                  data-method-type={card.gameProfile.identity.primaryMethodTypeId}
                  key={card.id}
                >
                  <button
                    className="manual-card-main"
                    type="button"
                    onClick={() =>
                      card.reportId && onNavigate(`/reports/${encodeURIComponent(card.reportId)}`)
                    }
                    disabled={!card.reportId}
                  >
                    <span className="manual-volume">
                      {formatCopy(copy.collection.volume, {
                        number:
                          locale === "zh-TW"
                            ? volumeNumber(cards.length - index)
                            : cards.length - index
                      })}
                    </span>
                    <GameIdentityMark motifId={card.gameProfile.identity.motifId} />
                    <MethodTypeLockup identity={card.gameProfile.identity} label={false} />
                    <span className="manual-identity-title">
                      {card.gameProfile.identity.title}
                    </span>
                    <strong>{card.displayName}</strong>
                    <small>{card.occupationTitle}</small>
                    <p>{card.gameProfile.identity.signatureMove}</p>
                    <PersonaBeats identity={card.gameProfile.identity} compact />
                    <div className="manual-card-radar">
                      <GameRadar
                        axes={card.gameProfile.axes}
                        compact
                        accentAxisId={card.gameProfile.highlightAxisId}
                        ariaLabel={formatCopy(copy.collection.radarLabel, {
                          name: card.displayName
                        })}
                      />
                    </div>
                    <time dateTime={card.updatedAt}>
                      {new Intl.DateTimeFormat(locale, {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                      }).format(new Date(card.updatedAt))}
                    </time>
                  </button>
                  <div className="manual-card-actions">
                    <span>
                      <Share2 size={13} aria-hidden="true" />
                      {card.shareSlug ? copy.collection.shared : copy.collection.notShared}
                    </span>
                    <button
                      type="button"
                      aria-label={formatCopy(copy.collection.removeLabel, {
                        name: card.displayName
                      })}
                      onClick={() => void removeCard(card)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {activity.length > 0 && (
            <section className="collection-activity" aria-labelledby="activity-title">
              <div>
                <span className="eyebrow">{copy.collection.activityEyebrow}</span>
                <h2 id="activity-title">{copy.collection.activityTitle}</h2>
              </div>
              <div className="collection-activity-list">
                {activity.map((item) => (
                  <button
                    type="button"
                    key={item.jobId}
                    onClick={() => onNavigate(`/jobs/${encodeURIComponent(item.jobId)}`)}
                  >
                    <LoaderCircle
                      className={item.status === "failed" ? undefined : "spin"}
                      size={16}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{new URL(item.targetUrl).hostname}</strong>
                      <small>
                        {item.status === "failed"
                          ? copy.collection.failed
                          : formatCopy(copy.collection.running, { progress: item.progress })}
                      </small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
