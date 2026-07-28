import {
  ArrowRight,
  BookMarked,
  LoaderCircle,
  LockKeyhole,
  Trash2
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { gameArchetypeCopy, gameRoastCopy } from "../game-copy";
import type { CollectionPage as CollectionResponse, HistoryItem, SkillCardSummary } from "../types";
import { GameRadar } from "./GameRadar";

async function loadCollection(): Promise<CollectionResponse> {
  const response = await fetch("/api/collection");
  const body = (await response.json().catch(() => ({}))) as CollectionResponse & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(body.error?.message ?? "藏經閣暫時打不開");
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
  const [cards, setCards] = useState<SkillCardSummary[]>([]);
  const [activity, setActivity] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await loadCollection();
      setCards(next.cards);
      setActivity(next.activity);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "藏經閣暫時打不開");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function removeCard(card: SkillCardSummary) {
    if (!window.confirm(`移除「${card.displayName}」`)) return;
    const response = await fetch(`/api/cards/${encodeURIComponent(card.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(body.error?.message ?? "這卷秘籍移除失敗");
      return;
    }
    setCards((current) => current.filter((candidate) => candidate.id !== card.id));
  }

  return (
    <main className="page-frame collection-page">
      <header className="page-heading collection-heading">
        <span className="eyebrow">MY COLLECTION</span>
        <h1>我的藏經閣</h1>
        <p>每次鑑定留下一卷畫像 同一目標與職業只保留最新版</p>
      </header>

      {loading ? (
        <div className="page-state" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <span>翻找秘籍中</span>
        </div>
      ) : error ? (
        <div className="page-state error-state" role="alert">
          <strong>藏經閣暫時打不開</strong>
          <span>{error}</span>
          <button className="secondary-button" type="button" onClick={() => void refresh()}>
            再試一次
          </button>
        </div>
      ) : cards.length === 0 && activity.length === 0 ? (
        <div className="page-state collection-empty">
          <span className="empty-icon">
            <BookMarked size={22} aria-hidden="true" />
          </span>
          <strong>藏經閣還是空的</strong>
          <span>鑑定一套 Skill 就會自動收錄</span>
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            去挖秘籍
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <>
          {cards.length > 0 && (
            <section className="collection-grid" aria-label="已收藏秘籍">
              {cards.map((card, index) => (
                <article className="manual-card" key={card.id}>
                  <button
                    className="manual-card-main"
                    type="button"
                    onClick={() =>
                      card.reportId && onNavigate(`/reports/${encodeURIComponent(card.reportId)}`)
                    }
                    disabled={!card.reportId}
                  >
                    <span className="manual-volume">
                      第{volumeNumber(cards.length - index)}卷
                    </span>
                    <GameRadar
                      axes={card.gameProfile.axes}
                      compact
                      ariaLabel={`${card.displayName} 六維畫像`}
                    />
                    <span className="manual-archetype">
                      {gameArchetypeCopy[card.gameProfile.archetypeId]}
                    </span>
                    <strong>{card.displayName}</strong>
                    <small>{card.occupationTitle}</small>
                    <p>{gameRoastCopy[card.gameProfile.roastId]}</p>
                    <time dateTime={card.updatedAt}>
                      {new Intl.DateTimeFormat("zh-TW", {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                      }).format(new Date(card.updatedAt))}
                    </time>
                  </button>
                  <div className="manual-card-actions">
                    <span>
                      <LockKeyhole size={13} aria-hidden="true" />
                      {card.shareSlug ? "已分享" : "私藏"}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${card.displayName}`}
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
                <span className="eyebrow">ACTIVITY</span>
                <h2 id="activity-title">鑑定動態</h2>
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
                      <strong>{item.displayName}</strong>
                      <small>{item.status === "failed" ? "鑑定失敗" : `鑑定中 ${item.progress}%`}</small>
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
