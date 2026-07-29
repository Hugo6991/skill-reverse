import type {
  GameAxisId,
  GameBadgeId
} from "./types";

export const gameAxisCopy: Record<
  GameAxisId,
  { label: string; english: string; description: string }
> = {
  money: {
    label: "賺錢能力",
    english: "Money potential",
    description: "採用後創造收入或節省高價值時間的可能"
  },
  spectacle: {
    label: "華麗程度",
    english: "Spectacle",
    description: "文檔 包裝 命名與呈現帶來的第一眼衝擊"
  },
  potency: {
    label: "靈驗程度",
    english: "Potency",
    description: "方法是否有明確問題 真實案例與可驗證結果"
  },
  activation: {
    label: "煉化難度",
    english: "Activation cost",
    description: "安裝 依賴 學習與長期維護需要付出的成本"
  },
  renown: {
    label: "江湖聲量",
    english: "Renown",
    description: "發布歸屬 Repository 觸達 採用線索 公開討論與近期維護"
  },
  ascension: {
    label: "飛升潛力",
    english: "Ascension potential",
    description: "脫離原始工具後跨場景遷移與組合的能力"
  }
};

export const gameBadgeCopy: Record<GameBadgeId, string> = {
  evidence_rich: "證據充足",
  low_dependency: "低依賴",
  portable: "可跨域",
  field_tested: "有人用過",
  well_maintained: "仍在修煉"
};

export const gameSignalCopy: Record<string, string> = {
  professional_delta: "職業基準差異",
  adoption_signals: "採用線索",
  reproducibility: "可重現程度",
  framework_shape: "框架形狀",
  source_surface: "來源呈現",
  presentation_density: "資訊密度",
  documented_presentation: "文檔呈現",
  visual_craft: "視覺工藝",
  distinct_naming: "專屬命名",
  interaction_design: "互動設計",
  claim_strength: "主張強度",
  verified_claims: "已核實主張",
  evidence_coverage: "證據覆蓋",
  workflow_depth: "流程深度",
  dependency_mentions: "依賴線索",
  conditional_setup: "條件設定",
  publisher_repository: "原始發布 repository",
  github_stars: "GitHub stars",
  github_forks: "GitHub forks",
  public_discussion: "公開討論",
  maintenance_recency: "最近維護",
  conditional_rules: "條件規則",
  dependency_surface: "依賴面"
};

export function gameSignalLabel(id: string, value?: number): string {
  const base = gameSignalCopy[id] ?? id;
  if (value === undefined) return base;
  if (id === "github_stars" || id === "github_forks") {
    return `${base} ${new Intl.NumberFormat("en", { notation: "compact" }).format(value)}`;
  }
  if (id === "public_discussion") return `${base} ${value}`;
  if (id === "maintenance_recency") return `${base} ${value} 天前`;
  return base;
}

export const attributionCopy = {
  repository_owner: "Repository owner",
  identified_creator: "Identified creator",
  source_creator: "Source creator"
} as const;
