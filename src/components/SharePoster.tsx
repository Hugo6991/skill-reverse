import { ScanSearch } from "lucide-react";
import { forwardRef } from "react";
import {
  gameAxisCopy,
  gameBadgeCopy
} from "../game-copy";
import type { GameProfile } from "../types";
import { GameRadar } from "./GameRadar";
import { GameIdentityMark } from "./GameIdentityMark";

export const SharePoster = forwardRef<
  HTMLElement,
  {
    displayName: string;
    occupationTitle: string;
    profile: GameProfile;
  }
>(function SharePoster({ displayName, occupationTitle, profile }, ref) {
  return (
    <article
      className={`share-poster motif-${profile.identity.motifId}`}
      data-axis={profile.highlightAxisId}
      data-accent={profile.accentAxisId}
      ref={ref}
    >
      <header>
        <span>
          <ScanSearch size={24} aria-hidden="true" />
          Skill Reverse
        </span>
        <small>秘籍鑑定</small>
      </header>
      <div className="share-poster-title">
        <span>{occupationTitle}</span>
        <div>
          <GameIdentityMark motifId={profile.identity.motifId} size={28} label={false} />
          <strong>{profile.identity.title}</strong>
        </div>
        <h1>{displayName}</h1>
      </div>
      <blockquote>{profile.identity.oneLiner}</blockquote>
      <div className="identity-traits">
        {profile.identity.traits.map((trait) => <span key={trait}>{trait}</span>)}
      </div>
      <GameRadar
        axes={profile.axes}
        accentAxisId={profile.highlightAxisId}
        ariaLabel={`${displayName} 六維畫像`}
      />
      <div className="share-poster-axes">
        {profile.axes.map((axis) => (
          <div key={axis.id}>
            <span>{gameAxisCopy[axis.id].label}</span>
            <strong>{axis.value ?? "未知"}</strong>
          </div>
        ))}
      </div>
      <footer>
        <div>
          {profile.badges.map((badge) => (
            <span key={badge}>{gameBadgeCopy[badge]}</span>
          ))}
        </div>
        <small>skill reverse · game-profile-v2</small>
      </footer>
    </article>
  );
});
