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
import { useLocale } from "../LocaleContext";
import type { GameMotifId } from "../types";

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
  const { copy } = useLocale();
  const Icon = icons[motifId];
  return (
    <span
      className={`identity-mark motif-${motifId}`}
      aria-label={label ? copy.game.motifs[motifId] : undefined}
    >
      <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}
