import { withoutTerminalFullStop } from "./text";
import type { ReverseReport } from "./types";

type ChatTrialReport = Pick<ReverseReport, "framework">;

export function buildChatPrompt(report: ChatTrialReport): string {
  const rules = report.framework.steps
    .map((step, index) => `${index + 1}. ${withoutTerminalFullStop(step.instruction)}`)
    .join("\n");

  return `我想用「${withoutTerminalFullStop(
    report.framework.name
  )}」處理我目前最需要解決的真實問題，不要先推薦我安裝 skill、plugin 或 agent

請先自行還原情境，再直接試跑，不要先要求我重新整理背景或填寫模板

開始前，先檢查你在這個聊天或專案中實際可讀到的資訊，包括：
- 目前與先前的對話
- 專案指示、已保存的記憶與偏好
- 附件、連結、文件、程式碼與先前產出
- 已做過的決定、嘗試、反饋、失敗與修正
- 已使用或提過的 prompt、skill、plugin、agent 與工具結果

只使用你實際能存取的內容，不要假裝看過不存在或無權讀取的資料

先在內部完成情境盤點，辨認：
- 我目前最可能的目標、對象、限制與成功標準
- 哪些是已有事實，哪些是合理推論，哪些仍缺少證據
- 缺口是會阻塞執行，還是可以先用合理假設繼續

請依照以下規則執行：
${rules}

執行原則：
1. 不要反問我已經在歷史對話、記憶、附件或既有產出中提供過的資訊
2. 即使情境不完整，也要選擇最可能的當前問題，清楚標示假設，先交付一版可用的初步結果
3. 不要只給我待確認清單、訪談問題或空白框架
4. 只有缺少的資訊會實質改變方向，而且無法用低風險假設補上時，才算真正阻塞
5. 若真的需要追問，放在初步結果之後，最多問一個影響最大的問題

最後請依序回答：
1. 你從既有資訊還原出的問題：列出關鍵事實、合理假設與無法存取的缺口
2. 初步結果：直接把框架套用到這個問題，給出具體判斷或產出
3. 這個框架額外替我看見了什麼
4. 哪些部分仍需要我的情境判斷，但不妨礙現在先做
5. 下一步最小行動，以及是否值得做成可重複使用的 prompt 或 skill；若只用一次，請明確建議不要封裝

不要因為資訊不完美而停在釐清階段；預設先做出 v0，再讓我用結果校正你`;
}
