import { ScanSearch, Sparkles } from "lucide-react";
import { forwardRef } from "react";
import {
  gameArchetypeCopy,
  gameAxisCopy,
  gameBadgeCopy,
  gameRoastCopy
} from "../game-copy";
import type { GameProfile } from "../types";
import { GameRadar } from "./GameRadar";

export const SharePoster = forwardRef<
  HTMLElement,
  {
    displayName: string;
    occupationTitle: string;
    profile: GameProfile;
  }
>(function SharePoster({ displayName, occupationTitle, profile }, ref) {
  return (
    <article className="share-poster" ref={ref}>
      <header>
        <span>
          <ScanSearch size={24} aria-hidden="true" />
          Skill Reverse
        </span>
        <small>秘籍鑑定</small>
      </header>
      <div className="share-poster-title">
        <span>{occupationTitle}</span>
        <h1>{displayName}</h1>
        <div>
          <Sparkles size={22} aria-hidden="true" />
          <span>命格</span>
          <strong>{gameArchetypeCopy[profile.archetypeId]}</strong>
        </div>
      </div>
      <GameRadar axes={profile.axes} ariaLabel={`${displayName} 六維命盤`} />
      <div className="share-poster-axes">
        {profile.axes.map((axis) => (
          <div key={axis.id}>
            <span>{gameAxisCopy[axis.id].label}</span>
            <strong>{axis.value ?? "未知"}</strong>
          </div>
        ))}
      </div>
      <blockquote>{gameRoastCopy[profile.roastId]}</blockquote>
      <footer>
        <div>
          {profile.badges.map((badge) => (
            <span key={badge}>{gameBadgeCopy[badge]}</span>
          ))}
        </div>
        <small>skill reverse · game-profile-v1</small>
      </footer>
    </article>
  );
});
