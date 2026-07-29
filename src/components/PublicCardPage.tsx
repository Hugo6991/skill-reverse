import { ArrowRight, LoaderCircle, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocale } from "../LocaleContext";
import { formatCopy } from "../locales";
import type { PublicSkillCard } from "../types";
import { GameRadar } from "./GameRadar";
import { GameIdentityMark } from "./GameIdentityMark";

export function PublicCardPage({
  slug,
  onNavigate
}: {
  slug: string;
  onNavigate(path: string): void;
}) {
  const { copy, locale } = useLocale();
  const [card, setCard] = useState<PublicSkillCard>();
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/cards/${encodeURIComponent(slug)}?lang=${encodeURIComponent(locale)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as PublicSkillCard & {
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? copy.publicCard.missing);
        setCard(body);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : copy.publicCard.missing)
      );
  }, [copy.publicCard.missing, locale, slug]);

  async function shareAgain() {
    if (!card) return;
    const text = formatCopy(copy.publicCard.shareText, {
      title: card.gameProfile.identity.title,
      summary: card.gameProfile.identity.oneLiner
    });
    if (navigator.share) {
      await navigator.share({ title: card.displayName, text, url: window.location.href });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
  }

  if (error) {
    return (
      <main className="page-frame page-state error-state">
        <strong>{copy.publicCard.missing}</strong>
        <span>{error}</span>
        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          {copy.publicCard.own}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </main>
    );
  }
  if (!card) {
    return (
      <main className="page-frame page-state" role="status">
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <span>{copy.publicCard.loading}</span>
      </main>
    );
  }

  return (
    <main className="public-card-page">
      <article
        className={`public-destiny-card motif-${card.gameProfile.identity.motifId}`}
        data-axis={card.gameProfile.highlightAxisId}
        data-accent={card.gameProfile.accentAxisId}
      >
        <header>
          <span>{copy.publicCard.kicker}</span>
          <button type="button" onClick={() => void shareAgain()}>
            <Share2 size={15} aria-hidden="true" />
            {copy.publicCard.shareAgain}
          </button>
        </header>
        <div className="public-card-title">
          <GameIdentityMark motifId={card.gameProfile.identity.motifId} size={32} />
          <span>{card.occupationTitle}</span>
          <strong>{card.gameProfile.identity.title}</strong>
          <h1>{card.displayName}</h1>
        </div>
        <blockquote>{card.gameProfile.identity.oneLiner}</blockquote>
        <div className="identity-traits">
          {card.gameProfile.identity.traits.map((trait) => <span key={trait}>{trait}</span>)}
        </div>
        <GameRadar
          axes={card.gameProfile.axes}
          accentAxisId={card.gameProfile.highlightAxisId}
        />
        <div className="public-axis-grid">
          {card.gameProfile.axes.map((axis) => (
            <div key={axis.id}>
              <span>{copy.game.axes[axis.id].label}</span>
              <strong>{axis.value ?? copy.game.unknown}</strong>
            </div>
          ))}
        </div>
        <div className="public-badges">
          {card.gameProfile.badges.map((badge) => (
            <span key={badge}>{copy.game.badges[badge]}</span>
          ))}
        </div>
      </article>
      <section className="public-card-cta">
        <div>
          <span className="eyebrow">{copy.publicCard.yourTurn}</span>
          <h2>{copy.publicCard.prompt}</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          {copy.publicCard.start}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </section>
    </main>
  );
}
