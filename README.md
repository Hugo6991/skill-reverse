# Skill Reverse

從一個已完成的公開成果，反向提取「可遷移的方法」、作者脈絡、可追溯證據與單一職業基準。

這不是網站複製器，也不是權威排行榜。followers、GitHub stars 與職業吻合度不會提高 claim 的真實性分數。

## 目前可用

- React + Vite 研究工作台與互動報告
- Hono API、Cloudflare Workflows、D1、R2、Browser Run
- Durable Objects 精確限制每人併發與每日研究預算
- Turnstile 後端 Siteverify
- Perplexity Sonar Pro 結構化 research
- TwitterAPI.io 定向作者貼文搜尋，可安全降級
- O*NET 30.3 starter catalog 與 Professional Delta
- locked → doctor → public 的安全部署流程
- 內建 `antfu.me` demo dossier，不會呼叫付費服務

## 最快開始

需要 Node.js 22 以上；專案的 `.node-version` 使用 Node.js 24。

```bash
pnpm install
pnpm setup:local
pnpm dev
```

開啟 `http://localhost:5173`。本地預設為 demo mode，使用 Cloudflare 官方 Turnstile 測試 keys，不會呼叫 Perplexity、TwitterAPI.io 或 Browser Run。

## 部署到 Cloudflare

目前 repository 尚未設定公開 GitHub remote；推到公開 GitHub/GitLab 後，把下方 URL 的 repo 部分換成實際網址，即可作為一鍵部署按鈕：

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](
  https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/REPO
)
```

Deploy to Cloudflare 會建立 locked preview，並依 `wrangler.jsonc` provision D1、R2、Durable Objects 與 Workers Builds。locked 狀態下 `/api/jobs` 固定回傳 `503 setup_required`，所以漏設 key 不會意外產生模型費用。

部署後執行：

```bash
pnpm setup:prod
```

setup wizard 會：

1. 確認 Wrangler 登入
2. 以隱藏輸入讀取 Perplexity、TwitterAPI.io、Turnstile keys
3. 透過 stdin 執行 `wrangler secret bulk`，不把 secrets 寫到檔案
4. 套用 D1 migrations
5. 驗證 D1、R2、Durable Objects、Workflow 與必要 provider 設定
6. 所有必要檢查通過後才設定 `SETUP_COMPLETE=true`

若提供只有 `Turnstile Sites Write` 權限的 scoped Cloudflare token，wizard 會自動建立 Managed widget 並限制正式 hostname；沒有 token 時則引導貼入 dashboard 建立的 site/secret keys。

### Production secrets

| Name | Required | Purpose |
|---|---:|---|
| `PERPLEXITY_API_KEY` | yes | Sonar Pro research |
| `TURNSTILE_SITE_KEY` | yes | Browser widget |
| `TURNSTILE_SECRET_KEY` | yes | Server-side Siteverify |
| `ANON_SESSION_SECRET` | generated | Signed anonymous session |
| `SETUP_CAPABILITY` | generated | Deep doctor authorization |
| `SETUP_COMPLETE` | generated | Unlocks public job creation |
| `TWITTERAPI_KEY` | no | Social provenance; missing means degraded report |

Cloudflare service credentials不需要放進環境變數；D1、R2、Browser Run、Workflow、Rate Limiting 與 Durable Objects 全部透過 bindings。

## 日常指令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm check
pnpm doctor https://your-deployment.example
pnpm deploy
```

`pnpm deploy` 會先 typecheck、test、build、套用向後相容 migration，再部署 Worker。設定 `SKILL_REVERSE_URL` 後會追加 public health check。

## API

- `POST /api/jobs`：建立研究工作
- `GET /api/jobs/:id`：查詢階段、成本與降級狀態
- `GET /api/reports/:id`：取得互動報告資料
- `DELETE /api/reports/:id`：用 capability token 刪除報告
- `GET /api/occupations?q=`：搜尋唯一職業
- `GET /api/health`：公開健康摘要
- `GET /api/health?deep=1`：需要 `x-setup-capability`

建立工作的 payload：

```json
{
  "targetUrl": "https://antfu.me",
  "supportUrls": ["https://github.com/antfu/antfu.me"],
  "occupationCode": "15-1255.00",
  "turnstileToken": "..."
}
```

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
- 尚未有公開 remote，因此 README 無法放入真實可點擊的 Deploy to Cloudflare repo URL
