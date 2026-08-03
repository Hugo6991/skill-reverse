import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer
} from "recharts";
import { useLocale } from "../LocaleContext";
import { gameAxisTheme } from "../game-theme";
import type { GameAxis, GameAxisId, HistoryAnalysisAxis } from "../types";

export function GameRadar({
  axes,
  compact = false,
  accentAxisId = "potency",
  ariaLabel
}: {
  axes: GameAxis[] | HistoryAnalysisAxis[];
  compact?: boolean;
  accentAxisId?: GameAxisId;
  ariaLabel?: string;
}) {
  const { copy } = useLocale();
  const theme = gameAxisTheme[accentAxisId];
  const data = axes.map((axis) => ({
    axis: copy.game.axes[axis.id].label,
    value: axis.value ?? 0,
    unknown: axis.value === undefined
  }));

  return (
    <div
      className={compact ? "game-radar game-radar-compact" : "game-radar"}
      role="img"
      aria-label={ariaLabel ?? copy.game.radarLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius={compact ? "72%" : "68%"}>
          <PolarGrid stroke="hsl(235 20% 82%)" radialLines />
          {!compact && (
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: "hsl(225 9% 39%)", fontSize: 12, fontWeight: 600 }}
            />
          )}
          <Radar
            dataKey="value"
            stroke={theme.stroke}
            fill={theme.fill}
            fillOpacity={0.22}
            strokeWidth={compact ? 1.5 : 2.5}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
      <span className="sr-only">
        {axes
          .map((axis) => {
            const value = axis.value === undefined ? copy.game.unknown : String(axis.value);
            return `${copy.game.axes[axis.id].label} ${value}`;
          })
          .join("　")}
      </span>
    </div>
  );
}

export function GameAxisList({
  axes,
  selected,
  onSelect
}: {
  axes: GameAxis[];
  selected: GameAxisId;
  onSelect(id: GameAxisId): void;
}) {
  const { copy } = useLocale();
  return (
    <div className="game-axis-list" aria-label={copy.game.selectAxis}>
      {axes.map((axis) => (
        <button
          className={selected === axis.id ? "active" : ""}
          key={axis.id}
          type="button"
          aria-pressed={selected === axis.id}
          onClick={() => onSelect(axis.id)}
        >
          <span>{copy.game.axes[axis.id].label}</span>
          <strong>{axis.value ?? copy.game.unknown}</strong>
        </button>
      ))}
    </div>
  );
}
