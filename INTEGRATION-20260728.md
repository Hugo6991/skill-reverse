# Integration：兩系統分工定案 + Agent-Callable API 規格（2026-07-28）

Hugo 的定調：「不用再本地安裝，任何 agent 直接 call API 拿結果。」本文件把這句話變成可實作的規格，並定案網站與本地 skill 的分工。給 Codex 實作；動工前 Hugo 批准。

## 1 兩系統分工定案

| | 網站（本 repo） | 本地 skill-reverse v1（~/.agents/skills/skill-reverse/） |
|---|---|---|
| 輸入 | 任意公開 HTTPS URL | GitHub skill repo |
| 基準 | O*NET 職業能力（Professional Delta） | 社群 skill 方法論（obra/Anthropic 等調研約束） |
| 作者層 | author delta（不進真實性分數） | provenance 時間線 + 採用權重評分（X 推文史、commit 鏈） |
| 把關 | 全自動（Turnstile+預算閘門） | 三個人工閘門（目標/身份/報告） |
| 產出 | 線上互動報告（匿名、7-30 天 TTL） | vault 報告（永久、Hugo 批准後可公開） |
| 量的東西 | claim 真實性（epistemic） | 採用決策權重（adoption） |

- 定案：兩者互補不合併。網站是「快而廣」的公開引擎；本地 skill 是「深而慢」的私人研究流程
- 長期 backlog：把 GitHub repo 深度模式（commit 作者鏈、fork 網絡分析、X 觀點時間線）移植進網站成第二種 job 類型；在那之前本地 skill 保留這條能力
- 本地 skill 的演化方向（不本輪執行）：加「委派模式」——目標是任意網站時，skill 不再本地跑 pipeline，改 call 網站 API（下方規格），拿回報告後只做本地加工（落 vault、職業視角、Hugo 閘門）

## 2 Agent-Callable API 規格（給 Codex 實作）

動機的實證：2026-07-28 實測，自動化瀏覽器（headless 與 headful）都被 Turnstile 正確攔截——防護該保留，agent 應走專用通道而非模擬人類。

### 設計

- 新增 secret：`AGENT_CAPABILITY`（sha256 hash 存放，沿用 SETUP_CAPABILITY 的模式與工具鏈；由 owner 在 setup wizard 或獨立命令產生，存密碼管理器）
- `POST /api/jobs` 增加分支：header `x-agent-capability` 有效時**跳過 Turnstile 驗證**，其餘全部照舊——zod 驗證、SSRF preflight、ActorGate（actor 改用 capability hash 派生，讓 agent 也吃 1 併發/2 每日）、DailyBudget、BURST_LIMITER
- 回應不變（202 + jobId）；agent 用既有 `GET /api/jobs/:id` 輪詢、`GET /api/reports/:id` 取結果——**不需要任何新讀取端點**，這是此設計最大的優點
- 濫用面控制：capability 洩漏的 blast radius = 每日 2 job × $0.50 上限 = $1/天，且 owner 隨時 rotate secret 即可作廢
- 明確不做：不做 per-agent 多 token 管理、不做 OAuth——單 owner 工具，一把 capability 夠用，複雜度不值得

### Agent 端呼叫（實作後的用法，寫給未來的 skill/文件）

```
POST https://skill-reverse.6991hugo.workers.dev/api/jobs
  headers: { "x-agent-capability": <token>, "content-type": "application/json" }
  body: { "targetUrl": "https://…", "occupationCode": "15-1252.00" }
→ 202 { jobId }
→ 輪詢 GET /api/jobs/:id 直到 status=completed（建議間隔 5s，總預算 ~5min）
→ GET /api/reports/:reportId
```

- 本地 skill v1 的委派模式即包一層這個呼叫 + 失敗降級（網站不可用時退回本地 pipeline）

## 3 便宜模型路由（Hugo 的原始需求，v-next）

- 現狀：pipeline 只用 Perplexity sonar-pro（research 一步全包）。Hugo 已表達要接 OpenRouter（可路由 Kimi、GPT 等便宜模型）
- 建議切法：research 拆兩段——(a) 證據整理/摘要（大量 token、低判斷密度）→ OpenRouter 便宜模型；(b) 結構化 claim 生成與 schema 輸出 → 保留 sonar-pro（其 search grounding 是核心價值）。secret 名 `OPENROUTER_API_KEY`，缺席時走現行單段路徑（soft degradation，別學 Perplexity 的硬 throw）
- 這同時是 REVIEW 發現 #1（Perplexity 單點）的 fallback 解法之一
- ⚠️ 2026-07-28 事件：Hugo 誤把 OpenRouter key 本體貼進 `wrangler secret put` 的名稱位置（指令失敗但 key 已進 shell history 與對話）——**該 key 應作廢重發**；正確流程：`pnpm exec wrangler secret put OPENROUTER_API_KEY` 後在隱藏提示貼值。另 Hugo 環境 default node 是 v21，需 `nvm use 24` 或用專案 `.node-version`（volta/fnm 自動切換）才能跑 wrangler

## 4 實作驗收（Codex 自檢）

- 無 capability 的 `POST /api/jobs` 行為與現在完全一致（Turnstile 必過）
- 帶錯誤 capability → 403，不洩漏是哪一段錯
- 帶正確 capability 的 job 走完整 pipeline 且吃預算閘門（測試：同 capability 第 3 個 job 當日被拒）
- `test/` 補：capability hash 比對、Turnstile bypass 分支、agent actor 派生
- README「目前可用」段補一行 agent API（不公開 token 生成方式細節）

---
關聯：`REVIEW-20260728-claude.md`（缺口清單）。本地 skill v1 的對應調整（委派模式、rubric 註記）由 Claude Code 在 Codex 實作完成後執行。
