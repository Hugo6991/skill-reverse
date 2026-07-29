import type {
  GameIdentity,
  GameIdentityCandidate,
  GameMotifId,
  ReverseReport
} from "../src/types";

export const GAME_IDENTITY_NAMING_VERSION = "four-beat-v1" as const;

export const GAME_MOTIF_IDS: GameMotifId[] = [
  "compass",
  "forge",
  "prism",
  "lattice",
  "beacon",
  "scroll",
  "shield",
  "lens"
];

export const RESERVED_IDENTITY_TITLES = [
  "法相驚人",
  "法相萬千",
  "生財有道",
  "大巧不工",
  "渡劫飛升",
  "名門正派",
  "隱世真傳",
  "即學即靈",
  "點石成金",
  "靈驗如神",
  "九劫難成",
  "威震江湖",
  "飛升有望",
  "文章內容",
  "方法流程",
  "分析框架",
  "系統方法",
  "操作流程",
  "使用方法",
  "內容輸出",
  "設計方法"
];

const FORBIDDEN_TITLE_STARTS = new Set([
  "以",
  "把",
  "將",
  "為",
  "從",
  "用",
  "讓",
  "由",
  "對",
  "於",
  "在",
  "和",
  "與",
  "及",
  "而",
  "其",
  "該",
  "此"
]);

const FORBIDDEN_TITLE_ENDS = new Set([
  "的",
  "之",
  "為",
  "以",
  "把",
  "將",
  "於",
  "中",
  "與",
  "及",
  "和",
  "而",
  "其",
  "該",
  "此"
]);

export interface IdentitySelectionContext {
  usedTitles?: string[];
  motifUsage?: Partial<Record<GameMotifId, number>>;
}

type IdentityInput = Pick<
  ReverseReport,
  "targetUrl" | "framework" | "claims" | "sources" | "professionalDelta" | "adoption"
>;

interface TitleRule {
  matches: (text: string) => boolean;
  titles: string[];
}

const TITLE_RULES: TitleRule[] = [
  {
    matches: (text) =>
      /威脅|threat/i.test(text) && /可編輯|模型|模擬|推演|model|simulation/i.test(text),
    titles: ["威脅沙盤", "攻防推演", "風險建模", "安全守門"]
  },
  {
    matches: (text) =>
      /圖文|圖像|圖片|視覺化|visual|image/i.test(text) ||
      (/文章|article/i.test(text) && /分段|編排|轉換|轉譯|segment|layout/i.test(text)),
    titles: ["圖文編排", "內容轉譯", "視覺分鏡", "圖像鍛造"]
  },
  {
    matches: (text) => /介面|元件|ui|ux|interface|component/i.test(text),
    titles: ["介面驗真", "元件稽核", "視覺校準", "體驗守門"]
  },
  {
    matches: (text) => /證據|來源|查證|取證|evidence|source|research/i.test(text),
    titles: ["證據鍛造", "來源溯真", "取證校準", "事實守門"]
  },
  {
    matches: (text) => /安全|風險|漏洞|攻擊|security|risk|vulnerability|attack/i.test(text),
    titles: ["風險守門", "攻防驗真", "安全推演", "漏洞稽核"]
  },
  {
    matches: (text) => /文件|文檔|寫作|說明|逐字稿|document|docs|writing|transcript/i.test(text),
    titles: ["文件鍛造", "文案編排", "寫作驗真", "知識校準"]
  },
  {
    matches: (text) => /設計|design|樣式|style|圖示|icon/i.test(text),
    titles: ["設計驗真", "視覺鍛造", "圖示取捨", "風格校準"]
  },
  {
    matches: (text) => /流程|步驟|閘門|管線|workflow|pipeline|process|gate/i.test(text),
    titles: ["流程守門", "步驟編排", "閘門驗真", "管線校準"]
  },
  {
    matches: (text) => /角色|受眾|情境|使用者|role|audience|context|user/i.test(text),
    titles: ["角色映射", "受眾校準", "情境推演", "需求守門"]
  },
  {
    matches: (text) => /品牌|首頁|入口|導覽|brand|homepage|navigation/i.test(text),
    titles: ["品牌羅盤", "入口編排", "首頁導引", "導覽校準"]
  },
  {
    matches: (text) => /測試|驗證|核對|test|verify|validation/i.test(text),
    titles: ["測試驗真", "驗證守門", "核對校準", "品質鍛造"]
  }
];

const GENERAL_DOMAINS = [
  "框架",
  "方法",
  "流程",
  "證據",
  "來源",
  "內容",
  "設計",
  "介面",
  "風險",
  "需求",
  "知識",
  "規則",
  "品質",
  "決策",
  "結構",
  "情境",
  "視覺",
  "文件",
  "模型",
  "素材"
];

const GENERAL_METHODS = [
  "拆解",
  "驗真",
  "編排",
  "校準",
  "守門",
  "映射",
  "鍛造",
  "導引",
  "推演",
  "溯源",
  "取捨",
  "轉譯",
  "歸納",
  "分鏡",
  "建模",
  "羅盤",
  "稽核",
  "提煉",
  "整流",
  "導航"
];

const ENGLISH_DOMAINS: Record<string, string> = {
  威脅: "Threat",
  攻防: "Defense",
  風險: "Risk",
  安全: "Security",
  圖文: "Visual",
  內容: "Content",
  視覺: "Visual",
  圖像: "Image",
  介面: "Interface",
  元件: "Component",
  體驗: "Experience",
  證據: "Evidence",
  來源: "Source",
  取證: "Evidence",
  事實: "Fact",
  文件: "Document",
  文案: "Copy",
  寫作: "Writing",
  知識: "Knowledge",
  設計: "Design",
  圖示: "Icon",
  風格: "Style",
  流程: "Workflow",
  步驟: "Step",
  閘門: "Gate",
  管線: "Pipeline",
  角色: "Role",
  受眾: "Audience",
  情境: "Context",
  需求: "Requirement",
  品牌: "Brand",
  入口: "Entry",
  首頁: "Homepage",
  導覽: "Navigation",
  測試: "Test",
  驗證: "Validation",
  核對: "Check",
  品質: "Quality",
  框架: "Framework",
  方法: "Method",
  規則: "Rule",
  決策: "Decision",
  結構: "Structure",
  模型: "Model",
  素材: "Asset"
};

const ENGLISH_METHODS: Record<string, string> = {
  沙盤: "Sandbox",
  推演: "Simulation",
  建模: "Modeling",
  守門: "Guard",
  編排: "Layout",
  轉譯: "Translation",
  分鏡: "Storyboard",
  鍛造: "Forge",
  驗真: "Verification",
  稽核: "Audit",
  校準: "Calibration",
  溯真: "Trace",
  取捨: "Tradeoffs",
  映射: "Mapping",
  導引: "Guide",
  拆解: "Breakdown",
  溯源: "Provenance",
  歸納: "Synthesis",
  羅盤: "Compass",
  提煉: "Distillation",
  整流: "Refinement",
  導航: "Navigation"
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compact(value: string): string {
  return value.replace(/[\s「」『』〈〉《》【】（）()[\]{}·・:：,，.。!！?？/\\_|-]/gu, "");
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function canonicalTitle(value: string): string {
  return value.trim();
}

export function isFourBeatTitle(value: string): boolean {
  const title = canonicalTitle(value);
  if (title !== compact(title)) return false;
  const characters = Array.from(title);
  return (
    characters.length === 4 &&
    /^\p{Script=Han}{4}$/u.test(title) &&
    !FORBIDDEN_TITLE_STARTS.has(characters[0]) &&
    !FORBIDDEN_TITLE_ENDS.has(characters[3]) &&
    !RESERVED_IDENTITY_TITLES.includes(title)
  );
}

export function isNaturalEnglishIdentityTitle(value: string): boolean {
  const title = value.trim();
  const words = title.split(/\s+/u).filter(Boolean);
  return (
    words.length >= 2 &&
    words.length <= 5 &&
    !/\p{Script=Han}/u.test(title) &&
    words.every((word) => /^[A-Za-z][A-Za-z'-]*$/u.test(word))
  );
}

export function englishIdentityTitle(
  sourceTitle: string,
  translatedTitle: string
): string {
  const translated = translatedTitle.trim();
  if (isNaturalEnglishIdentityTitle(translated)) return translated;
  const characters = Array.from(sourceTitle);
  const domain = ENGLISH_DOMAINS[characters.slice(0, 2).join("")];
  const method = ENGLISH_METHODS[characters.slice(2, 4).join("")];
  return domain && method ? `${domain} ${method}` : "Method Compass";
}

export function hasCurrentIdentityNaming(value: unknown): value is GameIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<GameIdentity>;
  return (
    identity.namingVersion === GAME_IDENTITY_NAMING_VERSION &&
    typeof identity.title === "string" &&
    isFourBeatTitle(identity.title) &&
    typeof identity.oneLiner === "string" &&
    Array.isArray(identity.traits) &&
    identity.traits.length === 3 &&
    typeof identity.motifId === "string" &&
    GAME_MOTIF_IDS.includes(identity.motifId)
  );
}

function identityText(input: IdentityInput): string {
  return [
    input.framework.name,
    input.framework.summary,
    input.framework.useWhen,
    input.framework.avoidWhen,
    ...input.framework.steps.flatMap((step) => [step.title, step.instruction])
  ].join(" ");
}

export function fourBeatTitleCandidates(input: IdentityInput): string[] {
  const text = identityText(input);
  const matched = TITLE_RULES.filter((rule) => rule.matches(text)).flatMap((rule) => rule.titles);
  const general = GENERAL_DOMAINS.flatMap((domain) =>
    GENERAL_METHODS.map((method) => `${domain}${method}`)
  );
  return unique([...matched, ...general]).filter(isFourBeatTitle);
}

function evidenceUrls(input: IdentityInput): string[] {
  const sourceById = new Map(input.sources.map((source) => [source.id, source.url]));
  const claimUrls = input.claims.flatMap((claim) =>
    claim.evidenceIds.map((id) => sourceById.get(id)).filter((url): url is string => Boolean(url))
  );
  return unique([...claimUrls, ...input.sources.map((source) => source.url)]).filter((url) => {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  });
}

function fallbackTraitCandidates(input: IdentityInput): string[] {
  const failureTypes = new Set(input.framework.steps.map((step) => step.failureType));
  return [
    input.claims.some((claim) => claim.status === "verified") ? "有據可驗" : "待實測",
    failureTypes.has("conditional") ? "條件先行" : "步驟清楚",
    input.professionalDelta.some((delta) => delta.manifestation === "author_specific_extension")
      ? "作者延伸"
      : "可作基線",
    input.adoption.length ? "可直接借用" : "先小試",
    failureTypes.has("omission") ? "防漏檢查" : "聚焦輸出",
    "保留取捨",
    "來源可查",
    "逐步套用"
  ];
}

function repairedTraits(
  input: IdentityInput,
  candidateTraits: readonly string[] = []
): [string, string, string] {
  const traits = unique(
    [...candidateTraits, ...fallbackTraitCandidates(input)]
      .map((trait) => compact(trait))
      .filter((trait) => characterCount(trait) >= 2 && characterCount(trait) <= 8)
  ).slice(0, 3);
  if (traits.length !== 3) throw new Error("Unable to derive three identity traits");
  return traits as [string, string, string];
}

function validatedCandidate(
  input: IdentityInput,
  candidate: GameIdentityCandidate,
  allowedUrls: Set<string>
): GameIdentityCandidate | undefined {
  const title = canonicalTitle(candidate.title);
  const oneLiner = candidate.oneLiner.trim();
  const urls = unique(candidate.evidenceUrls).filter((url) => allowedUrls.has(url));
  const genericOneLiner =
    /主要修的是法相|沒有一招封神|每一招都接得住|可能真能打|目前主要/u.test(
      oneLiner
    );
  if (
    !isFourBeatTitle(title) ||
    genericOneLiner ||
    characterCount(oneLiner) < 8 ||
    characterCount(oneLiner) > 72 ||
    urls.length === 0
  ) {
    return undefined;
  }
  return {
    title,
    oneLiner,
    traits: repairedTraits(input, candidate.traits),
    evidenceUrls: urls.slice(0, 3)
  };
}

function chooseMotif(
  seed: string,
  motifUsage: Partial<Record<GameMotifId, number>> = {}
): GameMotifId {
  const minimum = Math.min(...GAME_MOTIF_IDS.map((motif) => motifUsage[motif] ?? 0));
  const available = GAME_MOTIF_IDS.filter((motif) => (motifUsage[motif] ?? 0) === minimum);
  return available[stableHash(seed) % available.length];
}

function fallbackTitle(input: IdentityInput, unavailable: Set<string>): string {
  const selected = fourBeatTitleCandidates(input).find((title) => !unavailable.has(title));
  if (!selected) throw new Error("Unable to allocate a unique four-beat identity title");
  return selected;
}

function conciseClause(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/[。.!！]+$/u, "");
  if (characterCount(normalized) <= maxLength) return normalized;
  const characters = Array.from(normalized);
  const prefix = characters.slice(0, maxLength).join("");
  const boundary = Math.max(prefix.lastIndexOf("，"), prefix.lastIndexOf("、"), prefix.lastIndexOf("；"));
  return boundary >= 8 ? prefix.slice(0, boundary) : prefix;
}

export function fallbackGameIdentity(
  input: IdentityInput,
  context: IdentitySelectionContext = {},
  existingMotif?: GameMotifId
): GameIdentity {
  const unavailable = new Set([
    ...RESERVED_IDENTITY_TITLES,
    ...(context.usedTitles ?? []).map(canonicalTitle)
  ]);
  const title = fallbackTitle(input, unavailable);
  const summary = conciseClause(input.framework.summary, 30);
  const cost = conciseClause(input.framework.avoidWhen, 16);
  const oneLiner = `${title}把${summary}；代價是${cost}`;
  return {
    namingVersion: GAME_IDENTITY_NAMING_VERSION,
    title,
    oneLiner,
    traits: repairedTraits(input),
    motifId:
      existingMotif && GAME_MOTIF_IDS.includes(existingMotif)
        ? existingMotif
        : chooseMotif(title, context.motifUsage),
    evidenceUrls: evidenceUrls(input).slice(0, 3),
    source: "fallback"
  };
}

export function repairGameIdentity(
  input: IdentityInput,
  identity: Partial<GameIdentity> | undefined,
  context: IdentitySelectionContext = {}
): GameIdentity {
  const usedTitles = new Set((context.usedTitles ?? []).map(canonicalTitle));
  if (
    hasCurrentIdentityNaming(identity) &&
    !usedTitles.has(canonicalTitle(identity.title))
  ) {
    return identity;
  }
  return fallbackGameIdentity(input, context, identity?.motifId);
}

export function selectGameIdentity(
  input: IdentityInput,
  candidates: GameIdentityCandidate[] = [],
  context: IdentitySelectionContext = {}
): GameIdentity {
  const unavailable = new Set([
    ...RESERVED_IDENTITY_TITLES,
    ...(context.usedTitles ?? []).map(canonicalTitle)
  ]);
  const allowedUrls = new Set(evidenceUrls(input));
  const selected = candidates
    .map((candidate) => validatedCandidate(input, candidate, allowedUrls))
    .find(
      (candidate): candidate is GameIdentityCandidate =>
        Boolean(candidate) && !unavailable.has(candidate?.title ?? "")
    );
  if (!selected) return fallbackGameIdentity(input, context);
  return {
    ...selected,
    namingVersion: GAME_IDENTITY_NAMING_VERSION,
    motifId: chooseMotif(selected.title, context.motifUsage),
    source: "generated"
  };
}
