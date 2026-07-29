import {
  Compass,
  Gem,
  Hammer,
  Network,
  RadioTower,
  ScanSearch,
  ScrollText,
  ShieldCheck
} from "lucide-react";
import type { GameMotifId } from "../types";

const motifCopy: Record<GameMotifId, string> = {
  compass: "羅盤",
  forge: "鍛爐",
  prism: "稜鏡",
  lattice: "陣圖",
  beacon: "烽火",
  scroll: "卷軸",
  shield: "護印",
  lens: "照妖鏡"
};

const icons = {
  compass: Compass,
  forge: Hammer,
  prism: Gem,
  lattice: Network,
  beacon: RadioTower,
  scroll: ScrollText,
  shield: ShieldCheck,
  lens: ScanSearch
} satisfies Record<GameMotifId, typeof Compass>;

export function GameIdentityMark({
  motifId,
  size = 28,
  label = true
}: {
  motifId: GameMotifId;
  size?: number;
  label?: boolean;
}) {
  const Icon = icons[motifId];
  return (
    <span className={`identity-mark motif-${motifId}`} aria-label={label ? motifCopy[motifId] : undefined}>
      <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}
