import type {
  GameIdentity,
  GameIdentityCandidate,
  GameMotifId,
  MethodBeat,
  MethodSignal,
  MethodTypeId,
  ReverseReport
} from "../src/types";

export const GAME_IDENTITY_VERSION = "method-persona-v1" as const;
/** Kept for stored four-beat-v1 reports and translation compatibility. */
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

export const METHOD_TYPE_IDS = [
  "navigator",
  "investigator",
  "sentinel",
  "calibrator",
  "smith",
  "choreographer",
  "translator",
  "architect"
] as const;

type ConcreteMethodTypeId = (typeof METHOD_TYPE_IDS)[number];

export const METHOD_TYPE_LABELS: Record<ConcreteMethodTypeId, { zh: string; en: string }> = {
  navigator: { zh: "探路者", en: "Navigator" },
  investigator: { zh: "鑑證者", en: "Investigator" },
  sentinel: { zh: "守門人", en: "Sentinel" },
  calibrator: { zh: "校準師", en: "Calibrator" },
  smith: { zh: "鍛造師", en: "Smith" },
  choreographer: { zh: "編舞家", en: "Choreographer" },
  translator: { zh: "轉譯者", en: "Translator" },
  architect: { zh: "構築師", en: "Architect" }
};

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
  "設計方法",
  "來源溯真",
  "介面驗真",
  "圖文編排",
  "證據鍛造"
];

const FORBIDDEN_TITLE_STARTS = new Set([
  "以", "把", "將", "為", "從", "用", "讓", "由", "對", "於", "在", "和", "與", "及",
  "而", "其", "該", "此"
]);
const FORBIDDEN_TITLE_ENDS = new Set([
  "的", "之", "為", "以", "把", "將", "於", "中", "與", "及", "和", "而", "其", "該", "此"
]);

export interface IdentitySelectionContext {
  usedTitles?: string[];
  motifUsage?: Partial<Record<GameMotifId, number>>;
}

type IdentityInput = Pick<
  ReverseReport,
  | "targetUrl"
  | "framework"
  | "claims"
  | "observations"
  | "sources"
  | "professionalDelta"
  | "adoption"
  | "caveats"
>;

interface SignalRule {
  typeId: ConcreteMethodTypeId;
  pattern: RegExp;
  points: number;
}

interface TextSignal {
  ref: string;
  text: string;
}

const SIGNAL_RULES: SignalRule[] = [
  { typeId: "navigator", pattern: /模糊|分類|分流|路由|找路|路線|優先|排序|選擇|診斷|探索|ambigu|route|classif|prioriti|diagnos/i, points: 24 },
  { typeId: "investigator", pattern: /證據|來源|主張|查證|取證|核對|追查|研究|假設|evidence|source|claim|research|verify|hypothes/i, points: 22 },
  { typeId: "sentinel", pattern: /條件|風險|閘門|批准|門檻|安全|防漏|限制|停止|避免|不適合|risk|gate|approval|condition|guard|avoid|security/i, points: 21 },
  { typeId: "calibrator", pattern: /基準|對照|稽核|校準|一致|標準|偏差|修訂|檢查|測試|比較|baseline|audit|calibrat|standard|consisten|compare|test/i, points: 20 },
  { typeId: "smith", pattern: /產出|生成|製作|成品|草擬|建立|打造|創作|渲染|交付|produce|generat|create|build|artifact|render|deliver/i, points: 18 },
  { typeId: "choreographer", pattern: /階段|步驟|順序|流程|管線|先.+再|最後|節點|串起|stage|step|sequence|workflow|pipeline|orchestrat/i, points: 20 },
  { typeId: "translator", pattern: /轉換|轉譯|圖文化|視覺化|改寫|媒介|受眾|格式|分段|圖文|translate|transform|format|audience|visual|segment/i, points: 23 },
  { typeId: "architect", pattern: /結構|骨架|元件|系統|規範|規則|模板|可重用|框架|設計系統|architecture|structure|component|system|template|reus|framework/i, points: 18 }
];

const TYPE_TITLES: Record<ConcreteMethodTypeId, string[]> = {
  navigator: ["迷霧領航", "岔路定錨", "亂局探路", "暗處引航"],
  investigator: ["蛛絲成證", "線索照真", "疑點追光", "暗紋尋證"],
  sentinel: ["險處築壘", "關前止步", "暗礁守望", "危局推演"],
  calibrator: ["偏差定錨", "準繩照影", "尺度回聲", "微差歸準"],
  smith: ["素材成器", "原石淬形", "散材成章", "雛形淬火"],
  choreographer: ["步步成陣", "節點成章", "多幕合拍", "前後成局"],
  translator: ["換境傳意", "一語多形", "跨域折光", "長文變奏"],
  architect: ["骨架生長", "積木成城", "規則築城", "脈絡成網"]
};

const PAIR_TITLES: Partial<Record<`${ConcreteMethodTypeId}:${ConcreteMethodTypeId}`, string[]>> = {
  "navigator:investigator": ["迷霧領航", "疑陣探燈", "岔路定錨"],
  "translator:choreographer": ["換境傳意", "多幕轉場", "圖文成章", "長文變奏"],
  "sentinel:investigator": ["暗礁試探", "風險照影", "危局推演"],
  "calibrator:investigator": ["偏差定錨", "疑點校星", "準繩照影"],
  "smith:architect": ["素材成器", "積木成城", "雛形築骨"],
  "architect:sentinel": ["規則築城", "骨架守望", "邊界定錨"]
};

const TYPE_COPY: Record<
  ConcreteMethodTypeId,
  { move: string; strength: string; shadow: string; opening: string; criterion: string }
> = {
  navigator: {
    move: "面對模糊任務，它先分流，再決定往哪裡深入。",
    strength: "先縮小問題空間，避免一開始就猜答案。",
    shadow: "題目已經明確時，可能多走一道判斷流程。",
    opening: "先替問題找路",
    criterion: "依情境決定下一步"
  },
  investigator: {
    move: "它先追來源，再決定哪些主張值得相信。",
    strength: "把判斷綁回可核對的來源與證據。",
    shadow: "來源不足時，結論必須保留未知。",
    opening: "先追查來源",
    criterion: "以證據決定可信度"
  },
  sentinel: {
    move: "它先畫出邊界，再讓工作通過必要關卡。",
    strength: "把條件與風險放在投入成本之前。",
    shadow: "低風險任務可能被額外關卡拖慢。",
    opening: "先畫清楚邊界",
    criterion: "以風險決定是否放行"
  },
  calibrator: {
    move: "它先找出基準，再逐項修正偏差。",
    strength: "讓改動能對照同一套標準驗收。",
    shadow: "沒有可靠基準時，校準容易失去方向。",
    opening: "先建立比較基準",
    criterion: "以偏差決定修正幅度"
  },
  smith: {
    move: "它把零散素材逐步煉成可交付的成品。",
    strength: "能把模糊材料收斂成可使用的產物。",
    shadow: "輸入品質不足時，成品仍需要人工重煉。",
    opening: "先整理原始素材",
    criterion: "以可交付程度驗收"
  },
  choreographer: {
    move: "它把多個步驟排成能被檢查的節奏。",
    strength: "讓複雜工作在正確時點交接與驗收。",
    shadow: "簡單任務可能被過度拆成太多段落。",
    opening: "先安排步驟節奏",
    criterion: "以階段成果決定推進"
  },
  translator: {
    move: "它先抓住核心，再換成適合受眾的形式。",
    strength: "讓同一內容跨過媒介與理解門檻。",
    shadow: "轉換過度時，原始語境可能被壓縮。",
    opening: "先抽出核心訊息",
    criterion: "以受眾理解決定形式"
  },
  architect: {
    move: "它先搭骨架，再讓內容沿著規則生長。",
    strength: "把一次性做法整理成可重用結構。",
    shadow: "問題仍在快速變動時，骨架可能太早定型。",
    opening: "先搭出可重用骨架",
    criterion: "以結構一致性決定取捨"
  }
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

const ENGLISH_TITLES: Record<string, string> = {
  迷霧領航: "Navigate the Fog",
  岔路定錨: "Anchor the Crossroads",
  亂局探路: "Pathfinder in Chaos",
  疑陣探燈: "Lantern Through Doubt",
  蛛絲成證: "Threads into Proof",
  線索照真: "Clues into Truth",
  危局推演: "Simulate the Danger",
  險處築壘: "Fortify the Risk",
  偏差定錨: "Anchor the Deviation",
  素材成器: "Forge Raw Material",
  步步成陣: "Steps into Formation",
  長文變奏: "Longform Variations",
  換境傳意: "Meaning Across Contexts",
  骨架生長: "Structure that Grows",
  積木成城: "Blocks into Systems"
};

export function englishIdentityTitle(sourceTitle: string, translatedTitle: string): string {
  const translated = translatedTitle.trim();
  if (isNaturalEnglishIdentityTitle(translated)) return translated;
  return ENGLISH_TITLES[sourceTitle] ?? "Method in Motion";
}

const ENGLISH_TYPE_COPY: Record<
  MethodTypeId,
  { move: string; strength: string; shadow: string; opening: string; criterion: string }
> = {
  navigator: {
    move: "When the task is unclear, it routes first and investigates second.",
    strength: "It narrows the problem space before committing to an answer.",
    shadow: "A well-defined task may pick up an unnecessary decision step.",
    opening: "Route the problem first",
    criterion: "Choose the next move from context"
  },
  investigator: {
    move: "It traces sources before deciding which claims deserve trust.",
    strength: "It ties judgments back to evidence that can be checked.",
    shadow: "When sources are thin, the conclusion has to remain unknown.",
    opening: "Trace the source first",
    criterion: "Let evidence set confidence"
  },
  sentinel: {
    move: "It draws the boundary before work passes through the gate.",
    strength: "It puts conditions and risk ahead of expensive execution.",
    shadow: "Low-risk work can be slowed by an extra checkpoint.",
    opening: "Draw the boundary first",
    criterion: "Let risk decide passage"
  },
  calibrator: {
    move: "It establishes a baseline, then corrects deviations one by one.",
    strength: "It gives every change a consistent standard for review.",
    shadow: "Without a reliable baseline, calibration loses direction.",
    opening: "Set the baseline first",
    criterion: "Let deviation set the correction"
  },
  smith: {
    move: "It forges scattered material into something ready to deliver.",
    strength: "It turns ambiguous inputs into a usable artifact.",
    shadow: "Weak inputs still leave the final artifact needing rework.",
    opening: "Shape the raw material first",
    criterion: "Review by readiness to deliver"
  },
  choreographer: {
    move: "It arranges multiple steps into a rhythm that can be reviewed.",
    strength: "It makes complex work hand off and land at the right moments.",
    shadow: "Simple work can be split into more stages than it needs.",
    opening: "Arrange the sequence first",
    criterion: "Advance from stage outcomes"
  },
  translator: {
    move: "It finds the core, then changes form for the intended audience.",
    strength: "It carries the same idea across media and comprehension gaps.",
    shadow: "Too much transformation can compress the original context.",
    opening: "Extract the core first",
    criterion: "Choose form for the audience"
  },
  architect: {
    move: "It builds the structure before letting content grow through it.",
    strength: "It turns a one-off method into a reusable system.",
    shadow: "When the problem is still moving, the structure may set too early.",
    opening: "Build the reusable structure first",
    criterion: "Choose by structural consistency"
  },
  undetermined: {
    move: "The evidence is not yet strong enough to assign a stable method persona.",
    strength: "It preserves uncertainty instead of dressing thin signals as identity.",
    shadow: "More observable steps and sources are needed before the type can settle.",
    opening: "Keep the type open",
    criterion: "Classify only after more evidence"
  }
};

export function localizedEnglishIdentity(
  source: GameIdentity,
  translatedTitle = ""
): GameIdentity {
  const copy = ENGLISH_TYPE_COPY[source.primaryMethodTypeId];
  const secondaryCopy = source.secondaryMethodTypeId
    ? ENGLISH_TYPE_COPY[source.secondaryMethodTypeId]
    : copy;
  return {
    ...source,
    title: englishIdentityTitle(source.title, translatedTitle),
    signatureMove: copy.move,
    strength: copy.strength,
    shadow: copy.shadow,
    titleRationale: source.titleRationale.map((item, index) => ({
      ...item,
      explanation:
        index === 0
          ? "The first beat names the situation or tension found in the report."
          : "The second beat names the method's repeated action."
    })) as GameIdentity["titleRationale"],
    beats: [
      { ...source.beats[0], text: copy.opening },
      { ...source.beats[1], text: secondaryCopy.criterion },
      { ...source.beats[2], text: copy.shadow }
    ]
  };
}

function textSignals(input: IdentityInput): TextSignal[] {
  return [
    { ref: "framework.name", text: input.framework.name },
    { ref: "framework.summary", text: input.framework.summary },
    { ref: "framework.useWhen", text: input.framework.useWhen },
    { ref: "framework.avoidWhen", text: input.framework.avoidWhen },
    ...input.framework.steps.flatMap((step, index) => [
      { ref: `framework.step.${index + 1}`, text: `${step.title} ${step.instruction}` }
    ]),
    ...input.claims.map((claim) => ({ ref: claim.id, text: claim.text })),
    ...input.observations.map((item) => ({ ref: item.id, text: item.text })),
    ...input.caveats.map((text, index) => ({ ref: `caveat-${index + 1}`, text }))
  ];
}

export function methodSignals(input: IdentityInput): MethodSignal[] {
  const refsByType = new Map<ConcreteMethodTypeId, Set<string>>(
    METHOD_TYPE_IDS.map((id) => [id, new Set<string>()])
  );
  const scores = new Map<ConcreteMethodTypeId, number>(METHOD_TYPE_IDS.map((id) => [id, 0]));
  for (const item of textSignals(input)) {
    for (const rule of SIGNAL_RULES) {
      if (!rule.pattern.test(item.text)) continue;
      scores.set(rule.typeId, (scores.get(rule.typeId) ?? 0) + rule.points);
      refsByType.get(rule.typeId)?.add(item.ref);
    }
  }
  input.framework.steps.forEach((step, index) => {
    const ref = `framework.step.${index + 1}`;
    scores.set("choreographer", (scores.get("choreographer") ?? 0) + 5);
    refsByType.get("choreographer")?.add(ref);
    if (step.failureType === "conditional" || step.failureType === "omission") {
      scores.set("sentinel", (scores.get("sentinel") ?? 0) + 9);
      refsByType.get("sentinel")?.add(ref);
    }
    if (step.failureType === "discipline") {
      scores.set("calibrator", (scores.get("calibrator") ?? 0) + 7);
      refsByType.get("calibrator")?.add(ref);
    }
    if (step.failureType === "shape") {
      scores.set("architect", (scores.get("architect") ?? 0) + 7);
      refsByType.get("architect")?.add(ref);
    }
  });
  if (input.claims.some((claim) => claim.evidenceIds.length > 0)) {
    scores.set("investigator", (scores.get("investigator") ?? 0) + 12);
    input.claims
      .filter((claim) => claim.evidenceIds.length > 0)
      .forEach((claim) => refsByType.get("investigator")?.add(claim.id));
  }
  if (input.adoption.length > 0) {
    scores.set("architect", (scores.get("architect") ?? 0) + 8);
    refsByType.get("architect")?.add("adoption-1");
  }
  return METHOD_TYPE_IDS.map((typeId) => {
    const refs = [...(refsByType.get(typeId) ?? new Set<string>())];
    return {
      typeId,
      score: Math.min(100, scores.get(typeId) ?? 0),
      coverage: Math.min(100, refs.length * 18 + (input.sources.length > 0 ? 18 : 0)),
      evidenceRefs: refs.slice(0, 6)
    };
  }).sort((a, b) => b.score - a.score || b.coverage - a.coverage);
}

function methodTypes(input: IdentityInput, signals: MethodSignal[]): {
  primary: MethodTypeId;
  secondary?: ConcreteMethodTypeId;
} {
  const frameworkText = [
    input.framework.name,
    input.framework.summary,
    input.framework.useWhen,
    input.framework.avoidWhen,
    ...input.framework.steps.flatMap((step) => [step.title, step.instruction])
  ].join(" ");
  if (
    /模糊|不明確|ambigu/i.test(frameworkText) &&
    /分類|分流|路由|route|classif/i.test(frameworkText)
  ) {
    return { primary: "navigator", secondary: "investigator" };
  }
  if (
    /文章|長文|article|longform/i.test(frameworkText) &&
    /圖文|圖文化|投影片|視覺|分段|媒介|carousel|visual|segment/i.test(frameworkText)
  ) {
    return { primary: "translator", secondary: "choreographer" };
  }
  if (/威脅模型|threat model/i.test(frameworkText)) {
    return { primary: "sentinel", secondary: "investigator" };
  }
  const eligible = signals.filter((signal) => signal.coverage >= 40);
  const first = eligible[0];
  if (!first || first.score < 45) return { primary: "undetermined" };
  const preferredSecondary: Partial<Record<ConcreteMethodTypeId, ConcreteMethodTypeId>> = {
    navigator: "investigator",
    sentinel: "investigator",
    translator: "choreographer",
    smith: "architect"
  };
  const preferred = preferredSecondary[first.typeId];
  const preferredSignal = preferred
    ? eligible.find(
        (signal) => signal.typeId === preferred && signal.score >= 30
      )
    : undefined;
  if (preferredSignal) {
    return { primary: first.typeId, secondary: preferredSignal.typeId };
  }
  const second = eligible.find(
    (signal) =>
      signal.typeId !== first.typeId &&
      signal.score >= 35 &&
      first.score - signal.score <= 32
  );
  return { primary: first.typeId, secondary: second?.typeId };
}

function validEvidenceRefs(input: IdentityInput): Set<string> {
  return new Set([
    ...textSignals(input).map((item) => item.ref),
    ...input.sources.map((source) => source.id),
    ...input.adoption.map((_, index) => `adoption-${index + 1}`)
  ]);
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

function chooseMotif(typeId: MethodTypeId, seed: string): GameMotifId {
  const byType: Record<MethodTypeId, GameMotifId> = {
    navigator: "compass",
    investigator: "lens",
    sentinel: "shield",
    calibrator: "prism",
    smith: "forge",
    choreographer: "lattice",
    translator: "scroll",
    architect: "beacon",
    undetermined: GAME_MOTIF_IDS[stableHash(seed) % GAME_MOTIF_IDS.length]
  };
  return byType[typeId];
}

function titleCandidates(
  primary: MethodTypeId,
  secondary: ConcreteMethodTypeId | undefined
): string[] {
  if (primary === "undetermined") return ["脈絡未明", "線索未成", "輪廓待顯"];
  const pair = secondary
    ? PAIR_TITLES[`${primary}:${secondary}`] ?? PAIR_TITLES[`${secondary}:${primary}`]
    : undefined;
  return unique([...(pair ?? []), ...TYPE_TITLES[primary]]);
}

function fallbackTitle(
  input: IdentityInput,
  primary: MethodTypeId,
  secondary: ConcreteMethodTypeId | undefined,
  unavailable: Set<string>
): string {
  const text = textSignals(input).map((item) => item.text).join(" ");
  const reportSpecificTitle =
    /模糊/i.test(text) && /分類|分流|路由/i.test(text)
      ? "迷霧領航"
      : /文章內容圖文化|長文.{0,16}(?:圖文|圖像|投影片)|圖文化分段/i.test(text)
        ? "長文變奏"
        : /威脅模型|threat model/i.test(text)
          ? "危局推演"
          : undefined;
  if (
    reportSpecificTitle &&
    isFourBeatTitle(reportSpecificTitle) &&
    !unavailable.has(reportSpecificTitle)
  ) {
    return reportSpecificTitle;
  }
  const title = titleCandidates(primary, secondary).find(
    (candidate) => isFourBeatTitle(candidate) && !unavailable.has(candidate)
  );
  if (title) return title;
  for (const typeId of METHOD_TYPE_IDS) {
    const alternate = TYPE_TITLES[typeId].find(
      (candidate) => isFourBeatTitle(candidate) && !unavailable.has(candidate)
    );
    if (alternate) return alternate;
  }
  throw new Error("Unable to allocate a unique method-persona title");
}

function signalFor(signals: MethodSignal[], typeId: MethodTypeId): MethodSignal | undefined {
  return typeId === "undetermined"
    ? undefined
    : signals.find((signal) => signal.typeId === typeId);
}

function fallbackCopy(
  input: IdentityInput,
  primary: MethodTypeId,
  secondary: ConcreteMethodTypeId | undefined
) {
  const text = textSignals(input).map((item) => item.text).join(" ");
  if (/模糊/i.test(text) && /分類|分流|路由/i.test(text) && /證據|來源/i.test(text)) {
    return {
      signatureMove: "面對模糊任務，它先分流，再取證。",
      strength: "先縮小問題空間，避免模型一開始就猜答案。",
      shadow: "題目已經明確時，會多走一道判斷流程。",
      opening: "先替模糊任務分流",
      criterion: "再用證據決定深入方向"
    };
  }
  if (/文章|長文/i.test(text) && /圖文|圖文化|分段|投影片/i.test(text)) {
    return {
      signatureMove: "它先抓住長文核心，再編成適合閱讀的圖文節奏。",
      strength: "讓完整內容跨進圖文媒介而不只是截圖原文。",
      shadow: "壓縮過度時，技術語境與細節可能流失。",
      opening: "先抽出長文核心",
      criterion: "再依閱讀節奏安排圖文"
    };
  }
  if (/威脅模型|threat model/i.test(text)) {
    return {
      signatureMove: "它先建立可調整的威脅沙盤，再逐項驗證風險。",
      strength: "把風險當成待驗假設，而不是直接宣判漏洞。",
      shadow: "範圍很小或風險明確時，建模成本可能過高。",
      opening: "先建立威脅沙盤",
      criterion: "再用驗證決定是否修補"
    };
  }
  if (primary === "undetermined") {
    return {
      signatureMove: "目前證據還不足以判定這套方法的固定起手式。",
      strength: "保留未知，避免把薄弱線索包裝成人格結論。",
      shadow: "需要更多可觀察步驟與來源才能形成穩定類型。",
      opening: "先保留未定",
      criterion: "等更多證據再分類"
    };
  }
  const primaryCopy = TYPE_COPY[primary];
  const secondaryCopy = secondary ? TYPE_COPY[secondary] : undefined;
  return {
    signatureMove: primaryCopy.move,
    strength: primaryCopy.strength,
    shadow: primaryCopy.shadow,
    opening: primaryCopy.opening,
    criterion: secondaryCopy?.criterion ?? primaryCopy.criterion
  };
}

function buildBeats(
  copy: ReturnType<typeof fallbackCopy>,
  primarySignal: MethodSignal | undefined,
  secondarySignal: MethodSignal | undefined
): [MethodBeat, MethodBeat, MethodBeat] {
  const primaryRefs = primarySignal?.evidenceRefs.slice(0, 2) ?? ["framework.summary"];
  const secondaryRefs =
    secondarySignal?.evidenceRefs.slice(0, 2) ??
    primarySignal?.evidenceRefs.slice(1, 3) ??
    ["framework.useWhen"];
  return [
    { kind: "opening", text: copy.opening, evidenceRefs: primaryRefs },
    { kind: "criterion", text: copy.criterion, evidenceRefs: secondaryRefs },
    { kind: "shadow", text: copy.shadow, evidenceRefs: ["framework.avoidWhen"] }
  ];
}

function fallbackRationale(
  title: string,
  primary: MethodTypeId,
  secondary: ConcreteMethodTypeId | undefined,
  primarySignal: MethodSignal | undefined,
  secondarySignal: MethodSignal | undefined
): GameIdentity["titleRationale"] {
  const [first, second] = [Array.from(title).slice(0, 2).join(""), Array.from(title).slice(2).join("")];
  const primaryLabel =
    primary === "undetermined" ? "尚未定型" : METHOD_TYPE_LABELS[primary].zh;
  const secondaryLabel = secondary ? METHOD_TYPE_LABELS[secondary].zh : primaryLabel;
  return [
    {
      segment: first,
      explanation: `${first}對應這套方法面對的情境與張力（${primaryLabel}）`,
      evidenceRefs: primarySignal?.evidenceRefs.slice(0, 2) ?? ["framework.summary"]
    },
    {
      segment: second,
      explanation: `${second}對應它反覆採取的行動（${secondaryLabel}）`,
      evidenceRefs:
        secondarySignal?.evidenceRefs.slice(0, 2) ??
        primarySignal?.evidenceRefs.slice(1, 3) ??
        ["framework.useWhen"]
    }
  ];
}

function validatedCandidate(
  input: IdentityInput,
  candidate: GameIdentityCandidate,
  expected: ReturnType<typeof methodTypes>,
  allowedUrls: Set<string>,
  allowedRefs: Set<string>
): GameIdentityCandidate | undefined {
  const title = canonicalTitle(candidate.title);
  const characters = Array.from(title);
  const rationaleValid =
    candidate.titleRationale.length === 2 &&
    candidate.titleRationale[0].segment === characters.slice(0, 2).join("") &&
    candidate.titleRationale[1].segment === characters.slice(2, 4).join("") &&
    candidate.titleRationale.every(
      (item) =>
        item.explanation.trim().length >= 4 &&
        item.evidenceRefs.length > 0 &&
        item.evidenceRefs.every((ref) => allowedRefs.has(ref))
    );
  const urls = unique(candidate.evidenceUrls).filter((url) => allowedUrls.has(url));
  if (
    !isFourBeatTitle(title) ||
    candidate.primaryMethodTypeId !== expected.primary ||
    (expected.primary === "undetermined" && candidate.secondaryMethodTypeId) ||
    !rationaleValid ||
    characterCount(candidate.signatureMove.trim()) < 8 ||
    characterCount(candidate.signatureMove.trim()) > 72 ||
    characterCount(candidate.strength.trim()) < 8 ||
    characterCount(candidate.strength.trim()) > 72 ||
    characterCount(candidate.shadow.trim()) < 8 ||
    characterCount(candidate.shadow.trim()) > 72 ||
    urls.length === 0
  ) {
    return undefined;
  }
  return {
    ...candidate,
    title,
    secondaryMethodTypeId: expected.secondary,
    signatureMove: candidate.signatureMove.trim(),
    strength: candidate.strength.trim(),
    shadow: candidate.shadow.trim(),
    evidenceUrls: urls.slice(0, 3)
  };
}

export function hasCurrentIdentity(value: unknown): value is GameIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<GameIdentity>;
  return (
    identity.identityVersion === GAME_IDENTITY_VERSION &&
    typeof identity.title === "string" &&
    isFourBeatTitle(identity.title) &&
    typeof identity.signatureMove === "string" &&
    typeof identity.strength === "string" &&
    typeof identity.shadow === "string" &&
    Array.isArray(identity.titleRationale) &&
    identity.titleRationale.length === 2 &&
    Array.isArray(identity.beats) &&
    identity.beats.length === 3 &&
    Array.isArray(identity.methodSignals) &&
    typeof identity.motifId === "string" &&
    GAME_MOTIF_IDS.includes(identity.motifId)
  );
}

/** Historical alias used by older compatibility paths. */
export const hasCurrentIdentityNaming = hasCurrentIdentity;

export function fallbackGameIdentity(
  input: IdentityInput,
  context: IdentitySelectionContext = {},
  _existingMotif?: GameMotifId
): GameIdentity {
  const signals = methodSignals(input);
  const types = methodTypes(input, signals);
  const unavailable = new Set([
    ...RESERVED_IDENTITY_TITLES,
    ...(context.usedTitles ?? []).map(canonicalTitle)
  ]);
  const title = fallbackTitle(input, types.primary, types.secondary, unavailable);
  const primarySignal = signalFor(signals, types.primary);
  const secondarySignal = types.secondary ? signalFor(signals, types.secondary) : undefined;
  const copy = fallbackCopy(input, types.primary, types.secondary);
  return {
    identityVersion: GAME_IDENTITY_VERSION,
    title,
    primaryMethodTypeId: types.primary,
    secondaryMethodTypeId: types.secondary,
    titleRationale: fallbackRationale(
      title,
      types.primary,
      types.secondary,
      primarySignal,
      secondarySignal
    ),
    signatureMove: copy.signatureMove,
    strength: copy.strength,
    shadow: copy.shadow,
    beats: buildBeats(copy, primarySignal, secondarySignal),
    methodSignals: signals,
    motifId: chooseMotif(types.primary, title),
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
  if (hasCurrentIdentity(identity) && !usedTitles.has(canonicalTitle(identity.title))) {
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
  const signals = methodSignals(input);
  const types = methodTypes(input, signals);
  const allowedUrls = new Set(evidenceUrls(input));
  const allowedRefs = validEvidenceRefs(input);
  const selected = candidates
    .map((candidate) =>
      validatedCandidate(input, candidate, types, allowedUrls, allowedRefs)
    )
    .find(
      (candidate): candidate is GameIdentityCandidate =>
        Boolean(candidate) && !unavailable.has(candidate?.title ?? "")
    );
  if (!selected) return fallbackGameIdentity(input, context);
  const primarySignal = signalFor(signals, types.primary);
  const secondarySignal = types.secondary ? signalFor(signals, types.secondary) : undefined;
  const fallback = fallbackCopy(input, types.primary, types.secondary);
  const copy = {
    opening: fallback.opening,
    criterion: fallback.criterion,
    shadow: selected.shadow,
    signatureMove: selected.signatureMove,
    strength: selected.strength
  };
  return {
    ...selected,
    identityVersion: GAME_IDENTITY_VERSION,
    beats: buildBeats(copy, primarySignal, secondarySignal),
    methodSignals: signals,
    motifId: chooseMotif(types.primary, selected.title),
    source: "generated"
  };
}
