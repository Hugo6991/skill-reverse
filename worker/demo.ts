import type { ReverseReport } from "../src/types";
import { pilotOccupation } from "./occupations";

const generatedAt = "2026-07-28T00:00:00.000Z";

export const demoReport: ReverseReport = {
  id: "demo",
  title: "從個人作品網站反向推導「可檢查的設計工程」",
  targetUrl: "https://antfu.me",
  generatedAt,
  verdict:
    "這個成果的主要價值不在單一技術，而在把個人偏好轉成可重複檢查的工程約束。證據足以支持框架方向，但作者動機仍需用第一方長文或演講進一步核對。",
  framework: {
    name: "可檢查的設計工程",
    summary:
      "先把模糊品味轉為可觀察的界面規則，再把容易退化的部分交給工具檢查，最後保留需要情境判斷的空間。",
    useWhen: "成果同時包含設計決策、工程實作和長期維護訊號時。",
    avoidWhen: "只能看到視覺截圖，沒有原始內容、互動或可驗證的實作證據時。",
    steps: [
      {
        title: "找重複訊號",
        instruction: "先記錄成果反覆強調或刻意避免的行為，不急著替作者命名理念。",
        failureType: "omission"
      },
      {
        title: "把偏好寫成條件",
        instruction: "將觀察改寫為「當某情境出現時採取某決策」的可遷移規則。",
        failureType: "conditional"
      },
      {
        title: "分開窄橋與原野",
        instruction: "一致性要求交給工具，需脈絡判斷的選擇保留給人。",
        failureType: "discipline"
      },
      {
        title: "用反例測框架",
        instruction: "尋找不符合框架的頁面或決策，避免把所有結果硬塞進單一故事。",
        failureType: "shape"
      }
    ]
  },
  author: {
    name: "Anthony Fu",
    handle: "antfu7",
    background:
      "開源軟體作者與設計工程實作者，長期維護多個前端工具與個人知識作品。",
    context:
      "這份示範只把可直接取得的網站與公開專案訊號視為已擷取證據；作者動機與歷史脈絡仍標為需要原始來源核對。"
  },
  occupation: pilotOccupation,
  professionalDelta: [
    {
      competency: pilotOccupation.competencies[0],
      manifestation: "evidenced",
      rationale: "網站呈現了完整資訊架構、互動細節與持續維護痕跡。",
      evidenceIds: ["source-site", "claim-system"]
    },
    {
      competency: pilotOccupation.competencies[1],
      manifestation: "author_specific_extension",
      rationale: "設計不是只產出畫面，而是被轉成跨作品可重複的限制與慣例。",
      evidenceIds: ["claim-framework"]
    },
    {
      competency: pilotOccupation.competencies[2],
      manifestation: "evidenced",
      rationale: "成果包含技術內容、工具連結和可追溯的開源實作。",
      evidenceIds: ["source-site"]
    },
    {
      competency: pilotOccupation.competencies[3],
      manifestation: "not_observable",
      rationale: "網站能證明程式成果存在，但不能單靠結果判斷所有程式設計能力。",
      evidenceIds: []
    }
  ],
  observations: [
    {
      id: "obs-structure",
      text: "個人網站以作品、文章與持續更新的筆記共同呈現專業軌跡。",
      sourceIds: ["source-site"]
    },
    {
      id: "obs-system",
      text: "多個成果共享一致的命名、視覺和工具選擇，顯示可重用的決策系統。",
      sourceIds: ["source-site", "source-repo"]
    }
  ],
  claims: [
    {
      id: "claim-system",
      text: "成果把個人網站當成持續運作的專業系統，而非一次性作品集。",
      status: "supported_inference",
      confidence: 84,
      evidenceIds: ["source-site", "source-repo"],
      score: {
        directness: 25,
        firstParty: 20,
        corroboration: 15,
        temporalFit: 12,
        reproducibility: 12,
        contradictionPenalty: 0
      }
    },
    {
      id: "claim-framework",
      text: "作者傾向把設計偏好具體化為可以被工程流程持續維護的規則。",
      status: "supported_inference",
      confidence: 78,
      evidenceIds: ["source-site", "source-repo"],
      score: {
        directness: 22,
        firstParty: 20,
        corroboration: 12,
        temporalFit: 12,
        reproducibility: 12,
        contradictionPenalty: 0
      }
    }
  ],
  sources: [
    {
      id: "source-site",
      url: "https://antfu.me",
      kind: "website",
      status: "verified_at_retrieval",
      title: "Anthony Fu",
      retrievedAt: generatedAt,
      excerpt: "主要成果網站；示範報告使用固定快照資料，不代表即時查證。"
    },
    {
      id: "source-repo",
      url: "https://github.com/antfu/antfu.me",
      kind: "github",
      status: "inherited",
      title: "antfu/antfu.me",
      retrievedAt: generatedAt,
      excerpt: "在 blind run 中作為 holdout，不應反向洩漏進第一輪推論。"
    }
  ],
  edges: [
    {
      id: "edge-1",
      source: "source-site",
      target: "obs-structure",
      relation: "supports"
    },
    {
      id: "edge-2",
      source: "obs-structure",
      target: "claim-system",
      relation: "derived_from"
    },
    {
      id: "edge-3",
      source: "source-repo",
      target: "claim-framework",
      relation: "supports"
    }
  ],
  adoption: [
    "示範模式不將 GitHub stars 或社群追蹤數當作真實性證據。",
    "實際採用案例必須連回可取得的第三方原始來源後才會提升證據狀態。"
  ],
  caveats: [
    "這是產品內建示範，不是即時研究結果。",
    "查無貼文不等於作者沒有表達過相關觀點。",
    "職業基準用於比較，不用於評斷作者能力。"
  ],
  degraded: ["Demo snapshot：尚未呼叫 Perplexity、TwitterAPI.io 或 Browser Run"]
};
