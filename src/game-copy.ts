import type {
  GameArchetypeId,
  GameAxisId,
  GameBadgeId,
  GameRoastId
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
    description: "公開討論 第三方來源與近期活動留下的信號"
  },
  ascension: {
    label: "飛升潛力",
    english: "Ascension potential",
    description: "脫離原始工具後跨場景遷移與組合的能力"
  }
};

export const gameArchetypeCopy: Record<GameArchetypeId, string> = {
  wealth_with_proof: "生財有道",
  all_aura: "法相驚人",
  quiet_power: "大巧不工",
  hard_ascension: "渡劫飛升",
  famous_sect: "名門正派",
  hidden_manual: "隱世真傳",
  instant_magic: "即學即靈",
  money: "點石成金",
  spectacle: "法相萬千",
  potency: "靈驗如神",
  activation: "九劫難成",
  renown: "威震江湖",
  ascension: "飛升有望"
};

export const gameRoastCopy: Record<GameRoastId, string> = {
  all_aura: "這套功法目前主要修的是法相",
  famous_but_unproven: "江湖都聽過 親眼見過靈驗的人還不多",
  expensive_unknown_return: "渡劫成本不低 靈石回收期未知",
  valuable_hard_start: "能賺錢 但要先活過入門期",
  quiet_power: "沒什麼名氣 但可能真能打",
  portable_manual: "換個門派也能繼續用",
  balanced: "沒有一招封神 但每一招都接得住"
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
  claim_strength: "主張強度",
  verified_claims: "已核實主張",
  evidence_coverage: "證據覆蓋",
  workflow_depth: "流程深度",
  dependency_mentions: "依賴線索",
  conditional_setup: "條件設定",
  verified_social_sources: "公開討論",
  third_party_sources: "第三方來源",
  conditional_rules: "條件規則",
  dependency_surface: "依賴面"
};

export const attributionCopy = {
  repository_owner: "Repository owner",
  identified_creator: "Identified creator",
  source_creator: "Source creator"
} as const;
