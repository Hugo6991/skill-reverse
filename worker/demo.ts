import type { ReverseReport } from "../src/types";
import { createBilingualReportBundle } from "../src/bilingual";
import { computeGameProfile } from "./game-profile";
import { pilotOccupation } from "./occupations";

const generatedAt = "2026-07-28T00:00:00.000Z";

const demoReportBase: Omit<ReverseReport, "gameProfile"> = {
  id: "demo",
  title: "從 Anthropic skill-creator 提煉「先驗證，再封裝」",
  targetUrl: "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
  generatedAt,
  verdict:
    "值得先借用它的思考方式，不必急著安裝：先把真實工作流程寫成普通文字、用幾個案例驗證，只有反覆有效且常被漏做的部分，才值得封裝成 skill。",
  framework: {
    name: "先驗證，再封裝",
    summary:
      "先從真實對話裡辨認反覆出現的目標、修正與失敗，再用普通 prompt 試跑；穩定有效的規則才固定下來，需要情境判斷的部分繼續留給人與模型。",
    useWhen: "同一類任務反覆出現，而且你已經知道哪些步驟常被漏掉或做歪時。",
    avoidWhen: "只是第一次碰到問題、流程還在快速變動，或一段臨時 prompt 已經足夠時。",
    steps: [
      {
        title: "先找反覆發生的問題",
        instruction: "當同一類工作再次出現時，記下目標、輸入、你對 AI 的修正，以及什麼結果算完成。",
        failureType: "omission"
      },
      {
        title: "先寫成任何 Chat 都看得懂的文字",
        instruction: "當流程仍在探索時，先用普通語言寫出步驟與判斷條件，不綁定特定 agent 或工具。",
        failureType: "conditional"
      },
      {
        title: "用真實案例測，不靠感覺收藏",
        instruction: "當你覺得一套方法值得留下時，至少拿不同案例試跑，觀察它是否穩定改善結果。",
        failureType: "shape"
      },
      {
        title: "只封裝需要穩定重複的部分",
        instruction: "當某些步驟反覆有效又常被省略時，才把它們做成 skill；一次性背景與需要判斷的內容保留在對話裡。",
        failureType: "discipline"
      }
    ]
  },
  author: {
    kind: "team",
    name: "Anthropic Agent Skills team",
    background:
      "Anthropic 在官方 Agent Skills repository 公開 skill 規格、範例與實際使用的文件能力；這個案例取自其中的 skill-creator。",
    context:
      "skill-creator 先要求釐清意圖，再建立測試案例、比較結果並迭代。可支持的形成動機是：把對話中有效但容易流失的工作方式，變成可重複驗證的行為；更深的組織或個人哲學仍需第一方訪談才能確認。"
  },
  occupation: pilotOccupation,
  professionalDelta: [
    {
      competency: pilotOccupation.competencies[0],
      manifestation: "evidenced",
      rationale: "流程先定義使用情境與預期輸出，再進入實作與評估。",
      evidenceIds: ["source-skill", "claim-validation"]
    },
    {
      competency: pilotOccupation.competencies[1],
      manifestation: "author_specific_extension",
      rationale: "它把主觀的「這個 skill 好不好」轉成案例比較與可重複評估。",
      evidenceIds: ["source-skill", "claim-packaging"]
    },
    {
      competency: pilotOccupation.competencies[2],
      manifestation: "evidenced",
      rationale: "官方 repository 同時提供規格、範例與分層資源，讓做法可以追溯。",
      evidenceIds: ["source-repo"]
    },
    {
      competency: pilotOccupation.competencies[3],
      manifestation: "not_observable",
      rationale: "skill 文件能證明流程設計，不能單靠結果判斷團隊全部工程能力。",
      evidenceIds: []
    }
  ],
  observations: [
    {
      id: "obs-intent",
      text: "流程先從現有對話提取目標、觸發情境、輸出格式與成功標準。",
      sourceIds: ["source-skill"]
    },
    {
      id: "obs-evaluation",
      text: "草稿之後必須用測試提示實跑、比較結果並迭代，而不是寫完文件就算完成。",
      sourceIds: ["source-skill"]
    }
  ],
  claims: [
    {
      id: "claim-validation",
      text: "這套方法把 skill 視為需要用案例驗證的行為設計，不只是可收藏的指令文件。",
      status: "verified",
      confidence: 91,
      evidenceIds: ["source-skill"],
      score: {
        directness: 29,
        firstParty: 20,
        corroboration: 14,
        temporalFit: 14,
        reproducibility: 14,
        contradictionPenalty: 0
      }
    },
    {
      id: "claim-packaging",
      text: "先試跑再封裝，能避免把尚未穩定的一次性做法過早變成長期系統。",
      status: "supported_inference",
      confidence: 83,
      evidenceIds: ["source-skill", "source-repo"],
      score: {
        directness: 25,
        firstParty: 20,
        corroboration: 14,
        temporalFit: 12,
        reproducibility: 12,
        contradictionPenalty: 0
      }
    }
  ],
  sources: [
    {
      id: "source-skill",
      url: "https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md",
      kind: "github",
      status: "verified_at_retrieval",
      title: "Anthropic skill-creator / SKILL.md",
      retrievedAt: generatedAt,
      excerpt: "官方 skill 原始文件；示範報告使用固定快照資料，不代表即時查證。"
    },
    {
      id: "source-repo",
      url: "https://github.com/anthropics/skills",
      kind: "github",
      status: "verified_at_retrieval",
      title: "anthropics/skills",
      retrievedAt: generatedAt,
      excerpt: "官方 repository 說明與 Agent Skills 範例集合。",
      repositoryMetrics: {
        provider: "github",
        fullName: "anthropics/skills",
        ownerType: "Organization",
        stars: 164_700,
        forks: 19_600,
        watchers: 1_100,
        retrievedAt: generatedAt
      }
    }
  ],
  edges: [
    {
      id: "edge-1",
      source: "source-skill",
      target: "obs-intent",
      relation: "supports"
    },
    {
      id: "edge-2",
      source: "obs-intent",
      target: "claim-validation",
      relation: "derived_from"
    },
    {
      id: "edge-3",
      source: "source-repo",
      target: "claim-packaging",
      relation: "supports"
    }
  ],
  adoption: [
    "先從你已經發生過的對話與修正提取流程，不從空白模板開始。",
    "先寫成任何聊天 AI 都能理解的文字，跑過真實案例再封裝。",
    "只有穩定、反覆、容易被漏掉的步驟，才值得自動化。",
    "需要情境判斷的部分不要硬寫成絕對規則。"
  ],
  caveats: [
    "這是產品內建示範，不是即時研究結果。",
    "組織層級的設計哲學若沒有第一方訪談，只能標為推論。",
    "應用場景用於比較，不用於評斷創作者能力。"
  ],
  degraded: []
};

export const demoReport: ReverseReport = {
  ...demoReportBase,
  gameProfile: computeGameProfile(demoReportBase)
};

const demoOccupationEn = {
  ...pilotOccupation,
  title: "Web and Digital Interface Designers",
  description: "Design digital interfaces and websites with attention to usability, aesthetics, and functional behavior."
};

export const demoReportEn: ReverseReport = {
  ...demoReport,
  title: "Extracting “validate before packaging” from Anthropic skill-creator",
  verdict: "Borrow the thinking before installing anything: write the real workflow in plain language, validate it with several cases, and package only the parts that work repeatedly and are often skipped.",
  framework: {
    name: "Validate before packaging",
    summary: "Find recurring goals, corrections, and failures in real conversations, then test the method as an ordinary prompt. Stabilize only the rules that repeatedly work; leave contextual judgment to people and models.",
    useWhen: "Use it when the same kind of task recurs and you already know which steps are often skipped or distorted.",
    avoidWhen: "Avoid it for a first-time problem, a rapidly changing workflow, or when a temporary prompt is already enough.",
    steps: [
      {
        ...demoReport.framework.steps[0],
        title: "Find the recurring problem first",
        instruction: "When the same work returns, record the goal, inputs, corrections you gave the AI, and what counts as complete."
      },
      {
        ...demoReport.framework.steps[1],
        title: "Write it for any chat AI first",
        instruction: "While the process is still being discovered, state the steps and conditions in plain language without binding them to a particular agent or tool."
      },
      {
        ...demoReport.framework.steps[2],
        title: "Test real cases instead of collecting by instinct",
        instruction: "When a method seems worth keeping, run it on different real cases and see whether it consistently improves the result."
      },
      {
        ...demoReport.framework.steps[3],
        title: "Package only what must repeat reliably",
        instruction: "When steps repeatedly work and are frequently skipped, package those steps as a skill; keep one-off context and judgment in the conversation."
      }
    ]
  },
  author: {
    ...demoReport.author,
    background: "Anthropic publishes the Agent Skills specification, examples, and working document capabilities in its official repository. This case uses its skill-creator.",
    context: "The skill-creator clarifies intent before building test cases, comparing results, and iterating. The supported motivation is to turn effective but easily lost conversational practices into repeatable, testable behavior; deeper organizational philosophy would require first-party interviews."
  },
  gameProfile: {
    ...demoReport.gameProfile,
    identity: {
      ...demoReport.gameProfile.identity,
      title: "The Validation Smith",
      oneLiner: "Turns repeated conversational corrections into a method that earns its packaging",
      traits: ["evidence-led", "iteration-minded", "packaging-disciplined"]
    }
  },
  occupation: demoOccupationEn,
  professionalDelta: demoReport.professionalDelta.map((delta, index) => ({
    ...delta,
    competency: demoOccupationEn.competencies[index],
    rationale: [
      "The workflow defines the use context and desired output before implementation and evaluation.",
      "It turns a subjective judgment about skill quality into case comparison and repeatable evaluation.",
      "The official repository provides specifications, examples, and layered resources, making the method traceable.",
      "The skill document demonstrates process design but cannot establish the team’s full engineering capability."
    ][index]
  })),
  observations: demoReport.observations.map((observation, index) => ({
    ...observation,
    text: [
      "The workflow first extracts goals, trigger contexts, output formats, and success criteria from the existing conversation.",
      "After drafting, it must run test prompts, compare outcomes, and iterate rather than treating a completed document as finished."
    ][index]
  })),
  claims: demoReport.claims.map((claim, index) => ({
    ...claim,
    text: [
      "This method treats a skill as behavior that must be validated with cases, not merely an instruction file to collect.",
      "Testing before packaging helps prevent an unstable one-off method from becoming a long-term system too early."
    ][index]
  })),
  adoption: [
    "Extract the process from conversations and corrections that already happened instead of starting from a blank template.",
    "Write it so any chat AI can understand it, then run real cases before packaging.",
    "Automate only steps that are stable, repeated, and easy to skip.",
    "Do not force context-dependent judgment into absolute rules."
  ],
  caveats: [
    "This is a built-in example, not a live research result.",
    "Without a first-party interview, organization-level design philosophy remains an inference.",
    "The application context supports comparison; it does not grade the creator’s ability."
  ]
};

export const demoReportBundle = createBilingualReportBundle(demoReport, demoReportEn, {
  sourceLocale: "zh-TW",
  synthesizedAt: generatedAt,
  synthesisModel: "demo-fixture",
  translationModel: "demo-fixture",
  sourceContentHash: "demo-fixture-v2"
});
