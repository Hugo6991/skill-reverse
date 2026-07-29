import type {
  GameIdentity,
  GameIdentityCandidate,
  GameMotifId,
  ReverseReport
} from "../src/types";

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
  "飛升有望"
];

export interface IdentitySelectionContext {
  usedTitles?: string[];
  motifUsage?: Partial<Record<GameMotifId, number>>;
}

type IdentityInput = Pick<
  ReverseReport,
  "targetUrl" | "framework" | "claims" | "sources" | "professionalDelta" | "adoption"
>;

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
  return value.replace(/[\s「」『』〈〉《》【】（）()[\]{}·・:：,，.。!！?？/\\_\-|]/g, "");
}

function characterCount(value: string): number {
  return Array.from(compact(value)).length;
}

function normalizeTitle(value: string): string {
  return compact(value).slice(0, 10);
}

function hasTraditionalChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
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

function validatedCandidate(
  candidate: GameIdentityCandidate,
  allowedUrls: Set<string>
): GameIdentityCandidate | undefined {
  const title = normalizeTitle(candidate.title);
  const traits = unique(candidate.traits.map((trait) => compact(trait).slice(0, 8)));
  const urls = unique(candidate.evidenceUrls).filter((url) => allowedUrls.has(url));
  const genericOneLiner =
    /主要修的是法相|沒有一招封神|每一招都接得住|可能真能打|目前主要/u.test(
      candidate.oneLiner
    );
  if (
    characterCount(title) < 4 ||
    characterCount(title) > 10 ||
    !hasTraditionalChinese(title) ||
    RESERVED_IDENTITY_TITLES.includes(title) ||
    genericOneLiner ||
    candidate.oneLiner.trim().length < 8 ||
    traits.length !== 3 ||
    traits.some((trait) => characterCount(trait) < 2) ||
    !GAME_MOTIF_IDS.includes(candidate.motifId) ||
    urls.length === 0
  ) {
    return undefined;
  }
  return {
    title,
    oneLiner: candidate.oneLiner.trim().slice(0, 72),
    traits: [traits[0], traits[1], traits[2]],
    motifId: candidate.motifId,
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
  const raw = normalizeTitle(
    input.framework.name
      .replace(/\b(skill|framework|method|system|workflow|guide)\b/gi, "")
      .replace(/方法|框架|系統|指南|流程/g, "")
  );
  const roots = [
    "取證",
    "校準",
    "編排",
    "拆解",
    "守門",
    "映射",
    "鍛造",
    "導引",
    "驗真",
    "歸納"
  ];
  const forms = ["心法", "訣", "式", "譜", "策", "錄", "經", "法"];
  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const seed = `${input.targetUrl}:${input.framework.summary}`;
  let title =
    characterCount(raw) >= 4 &&
    characterCount(raw) <= 10 &&
    hasTraditionalChinese(raw)
      ? raw
      : `${roots[stableHash(seed) % roots.length]}${forms[stableHash(`${seed}:form`) % forms.length]}`;
  for (let attempt = 0; unavailable.has(title) && attempt < 9_600; attempt += 1) {
    const root = roots[(stableHash(seed) + attempt) % roots.length];
    const form = forms[
      (stableHash(`${seed}:form`) + Math.floor(attempt / roots.length)) % forms.length
    ];
    const cycle = Math.floor(attempt / (roots.length * forms.length));
    const marker =
      cycle === 0
        ? ""
        : `${stems[cycle % stems.length]}${branches[Math.floor(cycle / stems.length) % branches.length]}`;
    title = `${root}${marker}${form}`;
  }
  return title;
}

function fallbackTraits(input: IdentityInput): [string, string, string] {
  const failureTypes = new Set(input.framework.steps.map((step) => step.failureType));
  const candidates = [
    input.claims.some((claim) => claim.status === "verified") ? "有據可驗" : "待實測",
    failureTypes.has("conditional") ? "條件先行" : "步驟清楚",
    input.professionalDelta.some((delta) => delta.manifestation === "author_specific_extension")
      ? "作者延伸"
      : "可作基線",
    input.adoption.length ? "可直接借用" : "先小試",
    failureTypes.has("omission") ? "防漏檢查" : "聚焦輸出"
  ];
  const traits = unique(candidates).slice(0, 3);
  while (traits.length < 3) traits.push(["保留取捨", "來源可查", "逐步套用"][traits.length]);
  return traits as [string, string, string];
}

export function fallbackGameIdentity(
  input: IdentityInput,
  context: IdentitySelectionContext = {}
): GameIdentity {
  const unavailable = new Set([
    ...RESERVED_IDENTITY_TITLES,
    ...(context.usedTitles ?? []).map(normalizeTitle)
  ]);
  const title = fallbackTitle(input, unavailable);
  const summary = input.framework.summary.trim().replace(/[。.!！]+$/, "");
  const cost = input.framework.avoidWhen.trim().replace(/[。.!！]+$/, "");
  const oneLiner = `${title}把${summary.slice(0, 32).replace(/[A-Za-z]+$/u, "")}；代價是${cost
    .slice(0, 16)
    .replace(/[A-Za-z]+$/u, "")}`;
  return {
    title,
    oneLiner: oneLiner.slice(0, 72),
    traits: fallbackTraits(input),
    motifId: chooseMotif(title, context.motifUsage),
    evidenceUrls: evidenceUrls(input).slice(0, 3),
    source: "fallback"
  };
}

export function selectGameIdentity(
  input: IdentityInput,
  candidates: GameIdentityCandidate[] = [],
  context: IdentitySelectionContext = {}
): GameIdentity {
  const unavailable = new Set([
    ...RESERVED_IDENTITY_TITLES,
    ...(context.usedTitles ?? []).map(normalizeTitle)
  ]);
  const allowedUrls = new Set(evidenceUrls(input));
  const eligible = candidates
    .map((candidate, index) => ({
      candidate: validatedCandidate(candidate, allowedUrls),
      index
    }))
    .filter(
      (entry): entry is { candidate: GameIdentityCandidate; index: number } =>
        Boolean(entry.candidate) && !unavailable.has(entry.candidate?.title ?? "")
    )
    .sort((a, b) => {
      const motifDelta =
        (context.motifUsage?.[a.candidate.motifId] ?? 0) -
        (context.motifUsage?.[b.candidate.motifId] ?? 0);
      return motifDelta || a.index - b.index;
    });
  const selected = eligible[0]?.candidate;
  return selected
    ? { ...selected, source: "generated" }
    : fallbackGameIdentity(input, context);
}
