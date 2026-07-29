# Cross-Review：Skill Reverse 網站版（Claude Code，2026-07-28）

審核對象：本 repo HEAD `bdcd550`，線上部署 https://skill-reverse.6991hugo.workers.dev/（已驗證 mode=public）。審核者：Claude Code（本地 skill-reverse v1 的作者，交叉審核的另一方）。

## 總評

架構與安全紀律是高水準的：預算三重閘（ActorGate 併發/每日 + DailyBudget 冪等預留 + ratelimit）、secrets 全程 stdin 不落檔、SSRF preflight 手動跟 redirect 逐跳重驗、locked→smoke→public 的解鎖流程、build 後掃 dist 防 secret 外洩——這些都值得保留為範本。主要問題集中在三類：**(1) 韌性不對稱**（Perplexity 是唯一沒有降級路徑的外部依賴）、**(2) 聲明與代碼的落差**（「人氣不加分」只有 prompt 約束，無守衛無測試）、**(3) 存了但沒用的資產**（R2 截圖無讀取端點、FTS 表沒被查詢）。線上實測：Turnstile 正確攔截了自動化瀏覽器（防護有效），也因此完整 E2E 停在提交前——agent-callable 通道（見 INTEGRATION 文件）是解法，不是繞過。

## 發現（按嚴重度排序）

### P1 — 影響正確性或可用性

1. **Perplexity 無降級路徑，掛掉=整個 job 失敗**（`worker/services.ts:393` 缺 key 直接 throw；非 200 也 throw，workflow 重試 2 次後 job 標 failed）
   - 失敗場景:Perplexity 額度用盡或區域性阻斷（本機今天實測過 api.perplexity.ai 被掐斷 TLS 的真實案例）→ 使用者付出等待、預算被預留、拿到的是 research_failed
   - 與 social/補充來源的 soft-fail 設計哲學不一致。建議：至少把「額度耗盡」(402/429) 與「暫時性網路錯誤」區分，前者提前 fail-fast 並在 /api/health 反映，後者已有 retry。另可考慮 fallback provider（見 INTEGRATION 的 OpenRouter 規格）
2. **「followers/stars 不增加可信度」無代碼守衛**（唯一落實處：`worker/services.ts:368` prompt 規則 #4 + schema 無人氣欄位）
   - 失敗場景：模型把人氣資訊寫進 rationale 文字影響 confidence 的 6 項評分輸入（directness 等由模型自報素材推導），無任何測試斷言防 regression
   - 建議：(a) 在 `assembleReport` 加確定性檢查——rationale/claim 文字命中 `/followers|stars|粉絲|星數/` 且被用作 evidence 時降級或標記；(b) `test/core.test.ts` 加案例：餵入含人氣資訊的模型輸出，斷言 confidence 不受影響。README 的公開承諾需要可執行的守衛支撐
3. **R2 artifact 有寫無讀**（`worker/services.ts:248,253` put markdown/截圖；`ARTIFACTS.get` 只出現在 health canary `worker/index.ts:728-729`）
   - 後果：報告的證據鏈斷在最後一哩——claim 說「verified_at_retrieval」但使用者無法看到當時抓到的頁面快照。對一個 evidence-first 產品這是結構性缺口
   - 建議：`GET /api/reports/:id/artifacts/:n`（帶 report capability 或公開唯讀），報告頁 source ledger 連結快照與截圖

### P2 — 功能承諾未兌現

4. **`occupation_confirmation` stage 永不點亮**：`JobProgress` 進度條列了它，workflow 從不寫入——進度條有一格永遠跳過
5. **8 個補充來源只抓 3 個且無提示**（`selectCaptureSources` `.slice(0,3)`）：UI 讓人填 8 個，實際 Browser Run 只取前 3，違反「no silent caps」原則。建議 UI 明示或提高上限
6. **成本會計不全**：`actualCents` 只算 social + Perplexity 估算，Browser Run（最貴的操作之一）完全沒計入 → DailyBudget 的「實際花費」系統性低估。建議按 quickAction 次數計價
7. **`source_artifacts` 欄位寫死**：`author` 從未寫入、`metadata_json` 恆 `'{}'`、`status` 恆 `'verified_at_retrieval'`——inherited 來源（`:495-507` 補進報告的）沒有落到 DB 層，兩層資料模型不同步

### P3 — 品質債

8. **FTS5 表建了灌了但沒用**：`searchOccupations` 用 `LIKE %token%`；900+ 職業完整匯入後 LIKE 掃描會退化。建議切到 `occupations_fts` 查詢（本來就有）
9. **MODEL_SCHEMA 與 zod 平行定義漂移**：`observations.sourceUrls` 一邊 `.min(1)` 一邊無 minItems——同源生成或加一致性測試
10. **模型自報 `confidence` 要求了又丟棄**：schema 強制模型填、zod 驗證、`assembleReport` 一律覆蓋重算——白花 token 也誤導 schema 讀者，建議從 MODEL_SCHEMA 移除
11. **前端不送 `supportUrls`**：`POST /api/jobs` 收但 `ResearchForm` 不送（只有 90 秒視窗那條路）——保留則註明是 API-only 欄位，或刪掉

### 安全面評語（大體良好）

- 值得保留：capability 一律 sha256 hash 比對、Turnstile action 綁定驗證、`no-store`+`noindex`、public 模式吞 error message、build 掃 secret、deploy 前 copycheck
- 殘餘風險：(a) `x-setup-capability` 深層診斷與 smoke 端點共用一把 capability——考慮分權；(b) demo/locked/public 三態切換依賴 secret 字串比對，建議 health 深層檢查也驗 Turnstile secret 的有效性（目前 4/5 是因 social 可選缺席，正常）
- 線上實測記錄：headless 與 headful 自動化瀏覽器都被 Turnstile 攔在互動驗證（正確行為）；doctor 公開層 4/5 通過

## 哲學分歧的收斂（本審核的立場）

- 網站立場「人氣永不增加 claim 真實性」與本地 skill v1 的「author weight 30%」**不矛盾，是兩個不同的量**：
    - 網站的分數量的是「這個 claim 是真的嗎」（epistemic confidence）——人氣理應無關，立場正確，但需要守衛（見發現 #2）
    - skill v1 的 author 維度量的是「要不要採用這個人的方法」（adoption decision weight）——作者的過往產出、觀點一致性、實際採用案例是合理輸入
- 定案建議：兩系統各自保留自己的量，但都要明示自己量的是什麼；網站報告的 author delta 區塊可引用 provenance 資訊層（不進分數），skill v1 的 rubric 註明「author 分數是採用權重非真實性」。已在 skill v1 的報告 template 落實「讀分注意」。

## 給 Codex 的執行順序建議

P1 三項 → #6 成本會計 → #5 no-silent-caps → 其餘 P2/P3。每修一項補對應測試（目前 `ResearchWorkflow.run`、`runPerplexityResearch`、SSRF preflight、cron 清理全部零測試覆蓋——韌性修復先補這幾條的測試地基）。

---
關聯文件：`INTEGRATION-20260728.md`（兩系統分工 + agent-callable API 規格 + 便宜模型路由）
