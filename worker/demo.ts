import type { ReverseReport } from "../src/types";
import { pilotOccupation } from "./occupations";

const generatedAt = "2026-07-28T00:00:00.000Z";

export const demoReport: ReverseReport = {
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
    name: "Anthropic Agent Skills team",
    background:
      "Anthropic 在官方 Agent Skills repository 公開 skill 規格、範例與實際使用的文件能力；這個案例取自其中的 skill-creator。",
    context:
      "skill-creator 先要求釐清意圖，再建立測試案例、比較結果並迭代。可支持的形成動機是：把對話中有效但容易流失的工作方式，變成可重複驗證的行為；更深的組織或個人哲學仍需第一方訪談才能確認。"
  },
  gameProfile: {
    rubricVersion: "game-profile-v1",
    axes: [
      {
        id: "money",
        value: 70,
        coverage: 80,
        evidenceIds: ["source-skill", "source-repo"],
        signalIds: ["professional_delta", "adoption_signals", "reproducibility"]
      },
      {
        id: "spectacle",
        value: 45,
        coverage: 85,
        evidenceIds: ["source-skill", "source-repo"],
        signalIds: ["framework_shape", "source_surface", "presentation_density"]
      },
      {
        id: "potency",
        value: 90,
        coverage: 95,
        evidenceIds: ["source-skill", "source-repo"],
        signalIds: ["claim_strength", "verified_claims", "evidence_coverage"]
      },
      {
        id: "activation",
        value: 35,
        coverage: 85,
        evidenceIds: ["source-skill"],
        signalIds: ["workflow_depth", "dependency_mentions", "conditional_setup"]
      },
      {
        id: "renown",
        value: 55,
        coverage: 45,
        evidenceIds: ["source-repo"],
        signalIds: ["verified_social_sources", "third_party_sources"]
      },
      {
        id: "ascension",
        value: 85,
        coverage: 90,
        evidenceIds: ["source-skill", "source-repo"],
        signalIds: ["professional_delta", "conditional_rules", "dependency_surface"]
      }
    ],
    archetypeId: "quiet_power",
    roastId: "quiet_power",
    badges: ["evidence_rich", "low_dependency", "portable"],
    strongestAxisId: "potency",
    weakestAxisId: "activation",
    author: {
      avatarUrl: "https://github.com/anthropics.png?size=160",
      profileUrl: "https://github.com/anthropics",
      attribution: "repository_owner"
    }
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
      excerpt: "官方 repository 說明與 Agent Skills 範例集合。"
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
