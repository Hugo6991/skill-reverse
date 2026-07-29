import type { GameAxisId } from "./types";

export const gameAxisTheme: Record<
  GameAxisId,
  { stroke: string; fill: string; surface: string }
> = {
  money: { stroke: "hsl(38 82% 42%)", fill: "hsl(40 91% 55%)", surface: "hsl(45 84% 95%)" },
  spectacle: { stroke: "hsl(269 70% 49%)", fill: "hsl(271 78% 60%)", surface: "hsl(270 75% 96%)" },
  potency: { stroke: "hsl(157 58% 34%)", fill: "hsl(158 62% 45%)", surface: "hsl(153 56% 95%)" },
  activation: { stroke: "hsl(8 70% 48%)", fill: "hsl(8 78% 59%)", surface: "hsl(8 80% 96%)" },
  renown: { stroke: "hsl(218 69% 50%)", fill: "hsl(218 81% 61%)", surface: "hsl(216 78% 96%)" },
  ascension: { stroke: "hsl(190 70% 36%)", fill: "hsl(188 73% 46%)", surface: "hsl(187 65% 95%)" }
};
