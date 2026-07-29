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

請先自行還原情境，再直接完成任務，不要先要求我重新整理背景、確認你的理解或填寫模板

開始後，先在內部盤點你在這個聊天或專案中實際可讀到的資訊：
- 目前與先前的對話
- 專案指示、已保存的記憶與偏好
- 附件、連結、專案檔案、程式碼與先前產出
- 已使用或提過的 prompt、skill、plugin、agent 與工具結果
- 已做過的決定、嘗試、反饋、失敗與修正

只使用你實際能存取的內容，不要假裝看過不存在或無權讀取的資料

依照盤點結果還原我最可能的目標、對象、限制與成功標準；資訊不足時先用不會造成重大風險的合理假設補上，不要停下等待確認

請依照以下規則執行：
${rules}

執行原則：
1. 不要反問我已經在歷史對話、記憶、專案檔案、附件或既有產出中提供過的資訊
2. 第一輪就要直接交付一版完整、具體、可使用的 v1，不得用問題清單、訪談題、情境盤點或空白框架代替結果
3. 每個依賴推論的地方，都要在該內容旁直接標記「假設：<具體假設>，如果不對請糾正」，不得只在文末集中列出假設
4. 只有答案會改變產出方向，而且無法用低風險假設補上時，才算阻塞性問題
5. 純確認性、只會補充細節或可以自行合理假設的問題一律不要問

請嚴格依照以下順序回答：
1. 完整 v1 結果：直接把框架套用到目前最可能的真實問題，交付具體判斷、內容或可執行產出
2. 框架帶來的關鍵洞察：只補充會幫助我改善或使用 v1 的發現
3. 下一步最小行動與封裝建議：說明現在該做什麼，以及是否值得做成可重複使用的 prompt 或 skill；若只用一次，請明確建議不要封裝
4. 阻塞性問題（僅在需要時）：只能放在完整結果之後，最多三個；若沒有答案會改變產出方向的問題，省略整段

回覆的第一個實質段落必須是「完整 v1 結果」；不要因為資訊不完美而停在釐清階段`;
}
