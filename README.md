# Skill Reverse

從一個公開 skill、repo 或方法來源，反向提取「可遷移的思考框架」、創作者形成脈絡、可追溯證據與應用視角。

這不是 skill 收藏器、安裝推薦榜或權威排行榜。產品預設先把方法降維成可在任何聊天 AI 試跑的文字；只有反覆有效、容易漏做的流程才值得進一步封裝。followers、GitHub stars 與職業吻合度不會提高 claim 的真實性分數。

這是 owner-operated production application。原始碼 repository 維持 Private，不是公開 template，也不提供 fork 或一鍵複製部署流程。

這個產品如何從一個念頭逐步長成現在的系統，以及開發過程如何改變提問與 AI 協作方式，記錄在 [開發札記](./DEVELOPMENT-NOTES.md)。

## 目前可用

- React + Vite 研究工作台與互動報告
- Hono API、Cloudflare Queues、Workflows、D1、R2、Browser Run
- SQLite-backed Durable Objects 以全站 2 筆、每位使用者 1 筆的上限公平排程
- Turnstile 後端 Siteverify
- Perplexity Sonar Pro 結構化 research
- TwitterAPI.io 定向創作者貼文搜尋；X 是可選 provenance lane，缺席或失敗時只降級、不阻塞報告
- GitHub repo 優先辨識官方組織／團隊，沿 verified domain 與第一方網站查找社群連結，不強迫指定個人作者
- O*NET 30.3 starter catalog 與 Professional Delta
- 頂部導航、兩階段 URL composer、永久公開研究 archive 與可恢復進度頁
- 有證據展開層的六維 Skill 畫像、短評與版本化規則
- 瀏覽器匿名藏經閣、365 天輕量卡片與主動開啟的公開分享卡
- Cloudflare Access 站長管理頁、公開來源快照與 evidence screenshot
- locked → doctor → 真實研究 smoke → public 的安全部署流程
- GTM、GA4、Clarity、Mixpanel 與 Search Console 的 manifest-driven Analytics Stack as Code
- 內建 Anthropic `skill-creator` example brief，不會呼叫付費服務

## 最快開始

需要 Node.js 22 以上；專案的 `.node-version` 使用 Node.js 24。

```bash
pnpm install
pnpm setup:local
pnpm dev
```

開啟 `http://localhost:5173`。本地預設為 demo mode，使用 Cloudflare 官方 Turnstile 測試 keys，不會呼叫 Perplexity、TwitterAPI.io 或 Browser Run。

## Analytics 與 SEO

事件規格與非敏感平台 ID 分別版本化在 `analytics/events.json` 與 `analytics/stack.json`。先執行 `pnpm analytics:plan` 檢查本機 desired state；帳號資料未填時只會列出缺少項目，不會修改遠端。完整的第一次授權、`apply → publish → verify → export` 順序、GTM Preview 驗收與 SEO 索引邊界見 [ANALYTICS.md](./ANALYTICS.md)。

## Private production deployment

第一次部署由 owner 在本機執行：

```bash
pnpm bootstrap:cloudflare:dry-run
pnpm bootstrap:cloudflare
```

Bootstrap 會要求 Wrangler OAuth，查找或建立 `skill-reverse-db` D1、`skill-reverse-artifacts` R2、研究 Queue 與 DLQ，將真正的 D1 UUID 寫回 `wrangler.jsonc`，套用 migrations 並部署 locked Worker。它可以安全重跑；已存在的資源會被復用。

若不允許 Wrangler OAuth，可在本機終端以隱藏輸入設定具 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit 與 Queues Edit 權限的 scoped token；不要把 token 貼到聊天、command argument 或 repository：

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
2. 以隱藏輸入讀取 Perplexity、TwitterAPI.io、Turnstile keys 與 Cloudflare Access 設定
3. 部署 locked version 後，透過 stdin 逐項執行 `wrangler secret put`，不把 secrets 寫到檔案
4. 套用 D1 migrations
5. 驗證 D1、R2、Durable Objects、Workflow 與必要 provider 設定
6. 用 `antfu.me` 真實執行 Browser Run、Workflow、Perplexity、D1、R2 與報告驗證
7. 只有 smoke report、六維畫像、引用、verified claim 證據與成本全部通過，才設定 `SETUP_COMPLETE=true`

locked 狀態下 `/api/jobs` 固定回傳 `503 setup_required`，所以漏設 key 不會意外產生模型費用。完成 setup 後網站公開，但 GitHub repository 仍維持 Private。

成功時 wizard 只顯示一次新產生的 setup capability；請存入密碼管理器，之後 `pnpm doctor` 的 binding-level 診斷會使用它。

若提供只有 `Turnstile Sites Write` 權限的 scoped Cloudflare token，wizard 會自動建立 Managed widget 並限制正式 hostname；沒有 token 時則引導貼入 dashboard 建立的 site/secret keys。

### Private GitHub continuous deployment

首次部署與 `setup:prod` 完成後，在 Cloudflare Dashboard 的 `skill-reverse → Settings → Builds` 連接 GitHub：

- GitHub App repository access：只允許 `Hugo6991/skill-reverse`
- Production branch：`main`
- Root directory：`/`
- Build command：留空
- Production deploy command：`pnpm run deploy`
- Non-production deploy command：`pnpm run preview:upload`
- Build API token：Account scope 至少包含 Workers Scripts Edit、D1 Edit、Workers R2 Storage Edit、Queues Edit

Runtime secrets 只存放於 Worker，不要新增到 GitHub Actions、repository variables 或 Workers Builds build variables。只有 `main` push 能部署 production；其他 branch 只上傳 preview version。部署腳本會再次核對 `WORKERS_CI_BRANCH`，本機從其他分支執行 production deploy 也會預設拒絕。

### Production secrets

| Name | Required | Purpose |
|---|---:|---|
| `PERPLEXITY_API_KEY` | yes | Sonar Pro research |
| `OPENROUTER_API_KEY` | yes | OpenAI final synthesis and required English translation through OpenRouter |
| `TURNSTILE_SITE_KEY` | yes | Browser widget |
| `TURNSTILE_SECRET_KEY` | yes | Server-side Siteverify |
| `ANON_SESSION_SECRET` | generated | Signed anonymous session |
| `SETUP_CAPABILITY` | generated | Deep doctor authorization |
| `SETUP_COMPLETE` | generated | Unlocks public job creation |
| `TWITTERAPI_KEY` | no | Social provenance; missing means degraded report |
| `CF_ACCESS_TEAM_DOMAIN` | yes | Cloudflare Access issuer for owner moderation |
| `CF_ACCESS_AUD` | yes | Cloudflare Access application audience |
| `CF_ACCESS_ALLOWED_EMAIL` | yes | Owner email accepted by the Worker after Access verification |

Cloudflare service credentials不需要放進環境變數；Queues、D1、R2、Browser Run、Workflow、Rate Limiting 與 Durable Objects 全部透過 bindings。

### Owner API budget setup

Production 可以使用 owner 自己的 provider accounts，但應為這個網站建立獨立 API keys，不要重用日常開發 key：

1. 在 Perplexity 建立專用 key，先只加入少量 prepaid credits，並關閉 Auto reload。應用固定使用 Sonar Pro 的 low search context，另由 Worker 的單工作與每日預算閘門控制建立研究工作。
2. OpenRouter 使用獨立 key，預設模型為 `openai/gpt-5.6-terra`。最終 synthesis 故障時可保留 Perplexity 草稿並標記降級；但雙語報告仍需要 OpenRouter 完成英文翻譯，因此 production 必須設定此 key。
3. TwitterAPI.io key 是可選能力。使用獨立 key 與有限餘額；額度用完時只會降級 social provenance，不會讓整份報告失敗。
4. 在 Cloudflare Turnstile 建立 Managed widget，hostname 至少允許 `skill-reverse.vibeencode.dev`；保留 `skill-reverse.6991hugo.workers.dev` 可讓原始 Worker URL 繼續作為緊急回退。
5. 執行 `pnpm setup:prod`。Wizard 會辨識已存在的 Worker provider secrets，允許沿用而不必再次顯示或貼上；新增 secrets 仍只透過 stdin 寫入 Worker，永遠不進 GitHub、build variables 或前端 bundle。

公開 UI 不展示單工作成本、每日預算或內部研究準則；限制仍由 Durable Objects、Rate Limiting、Turnstile 與 provider 預付額度在後端執行。匿名 session 預設每日最多 20 個研究工作、最多保留 10 筆未完成工作；研究執行預設全站 2 筆、每位使用者 1 筆。分別可用 `ANON_DAILY_JOB_LIMIT`、`ACTOR_OUTSTANDING_JOB_LIMIT`、`GLOBAL_RESEARCH_CONCURRENCY` 與 `ACTOR_ACTIVE_JOB_LIMIT` 調整。

### Research queue

`POST /api/jobs` 只驗證請求、在 D1 建立 `queued` 工作，再將 job ID 寫入 Cloudflare Queue。Queue consumer 把工作冪等加入全站單例 `ResearchScheduler` Durable Object；排程器依加入時間與使用者公平限制啟動 Workflow。Workflow 完成或最終失敗後釋放名額，alarm 每分鐘回收遺失 callback 的工作。

暫時性 provider 錯誤在同一 Workflow step 自動重試一次，已完成的擷取與分析不會重做。Queue transport 最多重試三次，仍無法送達 Scheduler 時由 DLQ 將工作標記為失敗並釋放預算與 outstanding reservation。

## 日常指令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm bootstrap:cloudflare:dry-run
pnpm bootstrap:cloudflare
pnpm doctor https://skill-reverse.vibeencode.dev
pnpm qa:release
pnpm backup:prod
pnpm preview:upload
pnpm deploy
```

第一次套用新的 production migration 前使用 `pnpm release`，它會先匯出 D1 與 completed report 的 R2 reference inventory，再執行 deploy。`pnpm deploy` 只允許產品分支執行，會先 copycheck、typecheck、test、build、套用向後相容 migration，以正式 URL 規則精確回填 `target_key`，再部署 Worker。`pnpm preview:upload` 只驗證、建置與上傳 preview version，不執行 D1 migration。production deploy 完成後會自動對正式網址執行 release smoke；可用 `SKILL_REVERSE_URL` 覆寫驗證網址。`/api/health` 的 `version` 可用來核對線上 Worker version ID 與建立時間。完整架構、Access 設定、備份與恢復流程見 [ARCHITECTURE.md](./ARCHITECTURE.md)。

### Release QA gate

所有 production 變更都走同一條 fail-closed 流程：

1. 從最新 `main` 建 feature branch，只透過 PR 回到 `main`
2. PR 必須通過 `pnpm check`：文案、字體、CSS token、型別、完整測試、production build 與 Wrangler dry-run
3. UI 變更先上傳 preview，完成桌面、390px 行動版、鍵盤操作、雙語與錯誤狀態檢查
4. 合併前用 `git merge-tree` 或 GitHub mergeability 確認沒有衝突；過期或已被新版取代的 branch 不直接合併
5. Cloudflare 只從 `main` 部署；deploy script 會重新執行完整檢查、migration、回填與 Worker deploy
6. deploy 後自動執行 `pnpm qa:release`，驗證雙語首頁引用的每個 JS/CSS asset、缺檔 asset 必須 404、public health、雙語 archive API、robots 與 sitemap；任一步失敗即標記 release 失敗

也可以隨時對指定環境執行：

```bash
node scripts/release-smoke.mjs https://example-preview.workers.dev
```

`game-profile-v2` 回填預設只做 dry run：執行 `pnpm db:backfill-game-profiles:remote` 會按建立時間列出 payload 更新與卡片 upsert 數量，不會寫入正式資料。確認計畫後，使用 `pnpm db:backfill-game-profiles:apply`；這個命令會先執行正式備份，再以明確的 `--apply --backup-confirmed` 寫入報告 payload 與 `skill_cards.game_profile_json`。回填保留 report ID、分享 slug、公開狀態與收藏歸屬，失敗時不寫入完成標記，也不會替卡片開啟分享。

四字身份命名修復同樣預設為 dry run：`pnpm db:repair-game-identities:remote` 會依報告建立時間列出每筆中文名稱的前後對照、無效數、重複率、fallback 比例與意象分布。只有所有中文名稱都符合四字規格且沒有重複時，`pnpm db:repair-game-identities:apply` 才會先備份正式 D1，再同步更新 report payload 與既有 card profile；英文文案、六軸分數、report ID、分享 slug 與收藏歸屬不變。

## API

- `POST /api/jobs`：建立研究工作
- `GET /api/jobs/:id`：查詢排隊順位、階段、重試與降級狀態
- `GET /api/my-jobs`：讀取目前匿名 actor 的排隊中、執行中與失敗工作
- `PUT /api/jobs/:id/sources`：在 90 秒視窗補充或略過來源
- `GET /api/history?limit=&cursor=&targetUrl=`：讀取全站 completed + published 公開 archive
- `GET /api/collection`：讀取目前匿名瀏覽器的輕量卡片與研究動態
- `DELETE /api/cards/:id`：從目前瀏覽器的藏經閣移除卡片
- `POST /api/cards/:id/share`：主動為畫像卡開啟公開分享 slug
- `GET /api/public/cards/:slug`：讀取不含匿名身份與完整證據的公開畫像卡
- `GET /api/reports/:id`：取得 published 互動報告資料
- `GET /api/reports/:reportId/artifacts/:sourceId`：讀取保存時文字快照或 screenshot
- `GET/PATCH/DELETE /api/admin/reports...`：Cloudflare Access 保護的站長審核
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

完成的研究會進入永久公開 archive。藏經閣只是在目前瀏覽器保留 365 天的最新版入口；同一目標加同一職業視角會更新原卡片。畫像卡預設不產生公開 slug，只有使用者點擊分享後才開啟。刪除藏經閣卡片不會刪除已發布研究。

## 證據規則

- Browser Run 直接取得的公開內容標記為 `verified_at_retrieval`
- TwitterAPI.io 原文標記為 `verified-at-retrieval via third-party provider`
- Perplexity citations 在原始 URL 未直接取得前標記為 `inherited`
- 只有第一方來源確認的 X handle 才會啟動貼文搜尋；Perplexity 候選不得自動升級為已驗證身份
- 組織 repository 的 contributors 只作維護證據，不會被自動寫成原作者
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
