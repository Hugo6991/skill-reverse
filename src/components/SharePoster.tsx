import { ScanSearch } from "lucide-react";
import { forwardRef } from "react";
import { useLocale } from "../LocaleContext";
import { formatCopy } from "../locales";
import type { GameProfile } from "../types";
import { GameRadar } from "./GameRadar";
import { GameIdentityMark } from "./GameIdentityMark";
import { MethodTypeLockup, PersonaBeats } from "./MethodPersona";

export const SharePoster = forwardRef<
  HTMLElement,
  {
    displayName: string;
    occupationTitle: string;
    profile: GameProfile;
  }
>(function SharePoster({ displayName, occupationTitle, profile }, ref) {
  const { copy } = useLocale();
  return (
    <article
      className={`share-poster motif-${profile.identity.motifId}`}
      data-axis={profile.highlightAxisId}
      data-accent={profile.accentAxisId}
      data-method-type={profile.identity.primaryMethodTypeId}
      ref={ref}
    >
      <header>
        <span>
          <ScanSearch size={24} aria-hidden="true" />
          Skill Reverse
        </span>
        <small>{copy.game.kicker}</small>
      </header>
      <div className="share-poster-title">
        <span>{occupationTitle}</span>
        <MethodTypeLockup identity={profile.identity} />
        <div>
          <GameIdentityMark motifId={profile.identity.motifId} size={28} label={false} />
          <strong>{profile.identity.title}</strong>
        </div>
        <h1>{displayName}</h1>
      </div>
      <blockquote>{profile.identity.signatureMove}</blockquote>
      <div className="share-poster-tension">
        <p><span>{copy.game.strength}</span>{profile.identity.strength}</p>
        <p><span>{copy.game.shadow}</span>{profile.identity.shadow}</p>
      </div>
      <PersonaBeats identity={profile.identity} compact />
      <GameRadar
        axes={profile.axes}
        accentAxisId={profile.highlightAxisId}
        ariaLabel={formatCopy(copy.collection.radarLabel, { name: displayName })}
      />
      <div className="share-poster-axes">
        {profile.axes.map((axis) => (
          <div key={axis.id}>
            <span>{copy.game.axes[axis.id].label}</span>
            <strong>{axis.value ?? copy.game.unknown}</strong>
          </div>
        ))}
      </div>
      <footer>
        <div>
          {profile.badges.map((badge) => (
            <span key={badge}>{copy.game.badges[badge]}</span>
          ))}
        </div>
        <small>{copy.game.posterMark}</small>
      </footer>
    </article>
  );
});
