# Skill Reverse

從一個公開 skill、repo 或方法來源，反向提取「可遷移的思考框架」、創作者形成脈絡、可追溯證據與應用視角。

這不是 skill 收藏器、安裝推薦榜或權威排行榜。產品預設先把方法降維成可在任何聊天 AI 試跑的文字；只有反覆有效、容易漏做的流程才值得進一步封裝。followers、GitHub stars 與職業吻合度不會提高 claim 的真實性分數。

這是 owner-operated production application。原始碼 repository 維持 Private，不是公開 template，也不提供 fork 或一鍵複製部署流程。

## 目前可用

- React + Vite 研究工作台與互動報告
- Hono API、Cloudflare Workflows、D1、R2、Browser Run
- Durable Objects 精確限制每人併發與每日研究預算
- Turnstile 後端 Siteverify
- Perplexity Sonar Pro 結構化 research
- TwitterAPI.io 定向作者貼文搜尋，可安全降級
- O*NET 30.3 starter catalog 與 Professional Delta
- 頂部導航、兩階段 URL composer、匿名 History 與可恢復進度頁
- locked → doctor → 真實研究 smoke → public 的安全部署流程
- 內建 Anthropic `skill-creator` example brief，不會呼叫付費服務

## 最快開始

需要 Node.js 22 以上；專案的 `.node-version` 使用 Node.js 24。

```bash
pnpm install
pnpm setup:local
pnpm dev
```

開啟 `http://localhost:5173`。本地預設為 demo mode，使用 Cloudflare 官方 Turnstile 測試 keys，不會呼叫 Perplexity、TwitterAPI.io 或 Browser Run。

## Private production deployment

第一次部署由 owner 在本機執行：

```bash
pnpm bootstrap:cloudflare:dry-run
pnpm bootstrap:cloudflare
```

Bootstrap 會要求 Wrangler OAuth，查找或建立 `skill-reverse-db` D1 與 `skill-reverse-artifacts` R2，將真正的 D1 UUID 寫回 `wrangler.jsonc`，套用 migrations 並部署 locked Worker。它可以安全重跑；已存在的資源會被復用。

若不允許 Wrangler OAuth，可在本機終端以隱藏輸入設定具 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit 權限的 scoped token；不要把 token 貼到聊天、command argument 或 repository：

```bash
read -s CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
pnpm bootstrap:cloudflare
unset CLOUDFLARE_API_TOKEN
```

確認 locked deployment 的 `https://skill-reverse.vibeencode.dev` URL 後執行：

```bash
pnpm setup:prod
```

setup wizard 會：

1. 確認 Wrangler 登入
2. 以隱藏輸入讀取 Perplexity、TwitterAPI.io、Turnstile keys
3. 部署 locked version 後，透過 stdin 逐項執行 `wrangler secret put`，不把 secrets 寫到檔案
4. 套用 D1 migrations
5. 驗證 D1、R2、Durable Objects、Workflow 與必要 provider 設定
6. 用 `antfu.me` 真實執行 Browser Run、Workflow、Perplexity、D1、R2 與報告驗證
7. 只有 smoke report、引用、verified claim 證據與成本全部通過，才設定 `SETUP_COMPLETE=true`

locked 狀態下 `/api/jobs` 固定回傳 `503 setup_required`，所以漏設 key 不會意外產生模型費用。完成 setup 後網站公開，但 GitHub repository 仍維持 Private。

成功時 wizard 只顯示一次新產生的 setup capability；請存入密碼管理器，之後 `pnpm doctor` 的 binding-level 診斷會使用它。

若提供只有 `Turnstile Sites Write` 權限的 scoped Cloudflare token，wizard 會自動建立 Managed widget 並限制正式 hostname；沒有 token 時則引導貼入 dashboard 建立的 site/secret keys。

### Private GitHub continuous deployment

首次部署與 `setup:prod` 完成後，在 Cloudflare Dashboard 的 `skill-reverse → Settings → Builds` 連接 GitHub：

- GitHub App repository access：只允許 `Hugo6991/skill-reverse`
- Production branch：`main`
- Root directory：`/`
- Build command：留空
- Deploy command：`pnpm deploy`
- Build API token：Account scope 至少包含 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit

Runtime secrets 只存放於 Worker，不要新增到 GitHub Actions、repository variables 或 Workers Builds build variables。`main` push 會部署 production；其他 branch 只上傳 preview version。

### Production secrets

| Name | Required | Purpose |
|---|---:|---|
| `PERPLEXITY_API_KEY` | yes | Sonar Pro research |
| `OPENROUTER_API_KEY` | no | OpenAI final synthesis through OpenRouter |
| `TURNSTILE_SITE_KEY` | yes | Browser widget |
| `TURNSTILE_SECRET_KEY` | yes | Server-side Siteverify |
| `ANON_SESSION_SECRET` | generated | Signed anonymous session |
| `SETUP_CAPABILITY` | generated | Deep doctor authorization |
| `SETUP_COMPLETE` | generated | Unlocks public job creation |
| `TWITTERAPI_KEY` | no | Social provenance; missing means degraded report |

Cloudflare service credentials不需要放進環境變數；D1、R2、Browser Run、Workflow、Rate Limiting 與 Durable Objects 全部透過 bindings。

### Owner API budget setup

Production 可以使用 owner 自己的 provider accounts，但應為這個網站建立獨立 API keys，不要重用日常開發 key：

1. 在 Perplexity 建立專用 key，先只加入少量 prepaid credits，並關閉 Auto reload。應用固定使用 Sonar Pro 的 low search context，另由 Worker 的單工作與每日預算閘門控制建立研究工作。
2. OpenRouter 使用獨立 key，預設模型為 `openai/gpt-5.6-terra`，只負責將 Perplexity 研究草稿與已擷取證據匯整成最終報告。缺少或故障時會保留 Perplexity 草稿並標記降級。
3. TwitterAPI.io key 是可選能力。使用獨立 key 與有限餘額；額度用完時只會降級 social provenance，不會讓整份報告失敗。
4. 在 Cloudflare Turnstile 建立 Managed widget，hostname 至少允許 `skill-reverse.vibeencode.dev`；保留 `skill-reverse.6991hugo.workers.dev` 可讓原始 Worker URL 繼續作為緊急回退。
5. 執行 `pnpm setup:prod`。Wizard 會辨識已存在的 Worker provider secrets，允許沿用而不必再次顯示或貼上；新增 secrets 仍只透過 stdin 寫入 Worker，永遠不進 GitHub、build variables 或前端 bundle。

公開 UI 不展示單工作成本、每日預算或內部研究準則；限制仍由 Durable Objects、Rate Limiting、Turnstile 與 provider 預付額度在後端執行。匿名 session 預設每日最多 20 個研究工作，透過 `ANON_DAILY_JOB_LIMIT` 調整。

## 日常指令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm bootstrap:cloudflare:dry-run
pnpm bootstrap:cloudflare
pnpm doctor https://skill-reverse.vibeencode.dev
pnpm deploy
```

`pnpm deploy` 會先 typecheck、test、build、套用向後相容 migration，再部署 Worker。設定 `SKILL_REVERSE_URL` 後會追加 public health check。

## API

- `POST /api/jobs`：建立研究工作
- `GET /api/jobs/:id`：查詢階段、成本與降級狀態
- `PUT /api/jobs/:id/sources`：在 90 秒視窗補充或略過來源
- `GET /api/history`：讀取目前匿名 actor 的搜尋紀錄
- `DELETE /api/history/:jobId`：刪除目前匿名 actor 的終止工作與相關資料
- `GET /api/reports/:id`：取得互動報告資料
- `DELETE /api/reports/:id`：用 capability token 刪除報告
- `GET /api/occupations?q=`：搜尋唯一職業
- `POST /api/setup/smoke`：用 setup capability 啟動 production acceptance
- `GET /api/health`：公開健康摘要
- `GET /api/health?deep=1`：需要 `x-setup-capability`

建立工作的 payload：

```json
{
  "targetUrl": "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
  "occupationCode": "15-1255.00",
  "turnstileToken": "..."
}
```

建立工作後，前端立即進入 `/jobs/:jobId`。主頁擷取期間可選擇提交最多八個補充 HTTPS URL，或送出 `{ "urls": [], "finalize": true }` 立即略過；Browser Run 最多擷取其中三個高價值來源。

## 證據規則

- Browser Run 直接取得的公開內容標記為 `verified_at_retrieval`
- TwitterAPI.io 原文標記為 `verified-at-retrieval via third-party provider`
- Perplexity citations 在原始 URL 未直接取得前標記為 `inherited`
- `verified` claim 若沒有第一方已擷取來源，程式會自動降級
- 無 evidence ID 的 claim 不得高於 `plausible`
- `missing_but_expected` 沒有「為何此成果理應可觀察」的理由時，自動改成 `not_observable`
- 每次只提煉一個核心框架

## 資料與授權

O*NET 是美國勞工部贊助的職業資料庫。本專案 starter catalog 依 O*NET Database 30.3 整理，資料引用連回對應 occupation summary。O*NET database 採 [CC BY 4.0](https://www.onetcenter.org/license_agreements.html)；衍生資料必須保留 attribution 與修改說明。

TwitterAPI.io 是獨立第三方服務，與 X Corp. 無關。應用只使用讀取 endpoint，且不保存完整 timeline。

專案程式碼採 [MIT License](./LICENSE)。

## 已知邊界

- repository 內是可跑通 pilot 的 O*NET 30.3 starter catalog，不是 900+ occupations 的完整發行包；完整匯入器是下一個資料任務
- Browser Run Quick Actions 在本地需要 remote binding；一般本地開發刻意使用 demo/mock，避免付費與 remote 依賴
- D1 單庫為單執行序且上限 10 GB；若持續 overload 或 p95 query 超過 50 ms，應切分 D1 或遷移至 Postgres + Hyperdrive
- Production 使用 Cloudflare Workers Builds 的 private GitHub integration；repository 不提供公開 Deploy Button
