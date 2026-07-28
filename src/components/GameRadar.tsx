import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer
} from "recharts";
import { gameAxisCopy } from "../game-copy";
import type { GameAxis, GameAxisId } from "../types";

export function GameRadar({
  axes,
  compact = false,
  ariaLabel = "六維命盤"
}: {
  axes: GameAxis[];
  compact?: boolean;
  ariaLabel?: string;
}) {
  const data = axes.map((axis) => ({
    axis: gameAxisCopy[axis.id].label,
    value: axis.value ?? 0,
    unknown: axis.value === undefined
  }));

  return (
    <div
      className={compact ? "game-radar game-radar-compact" : "game-radar"}
      role="img"
      aria-label={ariaLabel}
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
            stroke="hsl(254 70% 54%)"
            fill="hsl(254 73% 59%)"
            fillOpacity={0.22}
            strokeWidth={compact ? 1.5 : 2.5}
            isAnimationActive={!compact}
            animationDuration={720}
          />
        </RadarChart>
      </ResponsiveContainer>
      <span className="sr-only">
        {axes
          .map((axis) => {
            const value = axis.value === undefined ? "未知" : String(axis.value);
            return `${gameAxisCopy[axis.id].label} ${value}`;
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
  return (
    <div className="game-axis-list" aria-label="選擇命盤維度">
      {axes.map((axis) => (
        <button
          className={selected === axis.id ? "active" : ""}
          key={axis.id}
          type="button"
          aria-pressed={selected === axis.id}
          onClick={() => onSelect(axis.id)}
        >
          <span>{gameAxisCopy[axis.id].label}</span>
          <strong>{axis.value ?? "未知"}</strong>
        </button>
      ))}
    </div>
  );
}
