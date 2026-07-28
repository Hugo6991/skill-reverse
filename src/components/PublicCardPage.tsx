import { ArrowRight, LoaderCircle, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  gameArchetypeCopy,
  gameAxisCopy,
  gameBadgeCopy,
  gameRoastCopy
} from "../game-copy";
import type { PublicSkillCard } from "../types";
import { GameRadar } from "./GameRadar";

export function PublicCardPage({
  slug,
  onNavigate
}: {
  slug: string;
  onNavigate(path: string): void;
}) {
  const [card, setCard] = useState<PublicSkillCard>();
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/cards/${encodeURIComponent(slug)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as PublicSkillCard & {
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? "這卷秘籍已失傳");
        setCard(body);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "這卷秘籍已失傳")
      );
  }, [slug]);

  async function shareAgain() {
    if (!card) return;
    const text = `我挖到一套「${gameArchetypeCopy[card.gameProfile.archetypeId]}」型 Skill\n${gameRoastCopy[card.gameProfile.roastId]}`;
    if (navigator.share) {
      await navigator.share({ title: card.displayName, text, url: window.location.href });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
  }

  if (error) {
    return (
      <main className="page-frame page-state error-state">
        <strong>這卷秘籍已失傳</strong>
        <span>{error}</span>
        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          自己挖一套
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </main>
    );
  }
  if (!card) {
    return (
      <main className="page-frame page-state" role="status">
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <span>展開畫像中</span>
      </main>
    );
  }

  return (
    <main className="public-card-page">
      <article className="public-destiny-card">
        <header>
          <span>秘籍鑑定</span>
          <button type="button" onClick={() => void shareAgain()}>
            <Share2 size={15} aria-hidden="true" />
            再分享
          </button>
        </header>
        <div className="public-card-title">
          <span>{card.occupationTitle}</span>
          <h1>{card.displayName}</h1>
          <strong>{gameArchetypeCopy[card.gameProfile.archetypeId]}</strong>
        </div>
        <GameRadar axes={card.gameProfile.axes} />
        <div className="public-axis-grid">
          {card.gameProfile.axes.map((axis) => (
            <div key={axis.id}>
              <span>{gameAxisCopy[axis.id].label}</span>
              <strong>{axis.value ?? "未知"}</strong>
            </div>
          ))}
        </div>
        <blockquote>{gameRoastCopy[card.gameProfile.roastId]}</blockquote>
        <div className="public-badges">
          {card.gameProfile.badges.map((badge) => (
            <span key={badge}>{gameBadgeCopy[badge]}</span>
          ))}
        </div>
      </article>
      <section className="public-card-cta">
        <div>
          <span className="eyebrow">YOUR TURN</span>
          <h2>你最近挖到哪套 Skill</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          開始鑑定
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
