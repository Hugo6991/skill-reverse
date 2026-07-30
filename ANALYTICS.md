# Analytics Stack as Code

這份文件是 Skill Reverse 的一次性設定 SOP。日後要換帳號、加事件或複製到其他網站，以 `analytics/stack.json`、`analytics/events.json` 與 `scripts/analytics.mjs` 為準，不需要重新在四個後台逐項點選。

## 邊界

- 瀏覽器只推送 `window.dataLayer`，不直接依賴 GA、Clarity 或 Mixpanel SDK。
- GTM 負責載入三個瀏覽器端供應商並映射事件。
- Worker 直接把研究生命週期送到 Mixpanel；關閉瀏覽器不會遺失 completed／failed 等狀態。
- 未知的遠端資源不刪除，`apply` 不發布，`publish` 永遠是獨立指令。
- 目前是本人使用的初期產品，因此沒有加入 consent banner、偏好設定入口或額外 policy UI。若日後對外開放，需重新檢查所在地與使用者所在地的法規需求。

## 第一次只做一次

### 1. Google

1. 建立或選擇 Google Tag Manager Account，記下 Account ID。
2. 建立或選擇 Google Analytics Account，記下 Account ID。
3. 建立 Google Cloud Project 與 Service Account。
4. 啟用 Tag Manager API、Google Analytics Admin API、Google Analytics Data API、Search Console API。
5. 在 GTM 把 Service Account email 加為使用者，授予 Edit 與 Publish。
6. 在 GA Account 把 Service Account email 加為 Editor。
7. 在 Search Console 把 Service Account email 加為 Full user 或 Owner。
8. 完成 `sc-domain:vibeencode.dev` 的 DNS 驗證。
9. 下載 Service Account JSON 到 Git 之外的位置。

### 2. Clarity

1. 建立 Project 並複製 Project ID。
2. Cookies 設為 On。
3. Masking 設為 Balanced。
4. Bot detection 設為 On。
5. 若需要資料匯出，再建立 Data Export API token；它只放密碼管理器或本機環境。

Clarity 沒有完整的 Project Admin API，所以以上 Project-level 設定仍是刻意保留的手動步驟。

### 3. Mixpanel

1. 建立 Organization 與 Project。
2. 記下 Project ID、Project Token 與 region（`US`、`EU` 或 `IN`）。
3. 建立 Project Admin Service Account。
4. 立即把 username 與只顯示一次的 secret 放入密碼管理器。

### 4. 填 manifest

把非敏感 ID 填入 `analytics/stack.json`。已存在的 ID 會被採用；Container、GA Property 或 Web Stream ID 留空時，`apply` 會在指定 Account 下建立並把結果寫入 `analytics/state.json`。

`gtmPublicId` 與 `gaMeasurementId` 是公開識別碼，Mixpanel Project Token 也是瀏覽器端 token，可以版本化。Service Account secret、OAuth token、Clarity export token 與 GA Measurement Protocol secret不可進 Git。

## 本機憑證

在執行 analytics 指令的 shell 提供：

```text
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json
MIXPANEL_SERVICE_ACCOUNT_USERNAME=...
MIXPANEL_SERVICE_ACCOUNT_SECRET=...
CLARITY_EXPORT_TOKEN=...
GA_MEASUREMENT_PROTOCOL_SECRET=...
```

GA Measurement Protocol secret 若不存在，`analytics:apply` 會建立一個 `[managed] Analytics Stack` secret，僅寫入被 Git 忽略且權限為 `0600` 的 `.analytics-secrets/ga-measurement-protocol-secret`。確認後應移入密碼管理器；腳本永遠不把 secret 印到 log、state、snapshot 或 export。

Worker 會直接讀取 `analytics/stack.json` 的 Project Token 與 region。若部署時需要覆寫，才設定：

```text
MIXPANEL_TOKEN=<analytics/stack.json 的 projectToken>
MIXPANEL_REGION=US
MIXPANEL_API_HOST=https://api.mixpanel.com
```

Project Token 不是管理憑證。Region 為 EU／IN 時 API host 分別改成 `https://api-eu.mixpanel.com`／`https://api-in.mixpanel.com`。

## 操作順序

```bash
pnpm analytics:plan
pnpm analytics:apply
pnpm analytics:plan
pnpm analytics:publish
pnpm analytics:verify
pnpm analytics:export
```

1. `plan` 只讀遠端。帳號資料未填時會列出缺少項目，不會失敗或建立資源。
2. `apply` 先把遠端狀態存到被忽略的 `.analytics-backups/`，再 reconcile GTM、GA4、Mixpanel Lexicon 與 Search Console sitemap。它不刪除、不發布。
3. 第二次 `plan` 應全部顯示 `KEEP`。若出現 `UPDATE`，先檢查是否有人在 UI 改了 `[managed]` 資源。
4. `publish` 先同步 GTM workspace；有 conflict 就停止。版本名稱包含 UTC 日期、Git commit 與 manifest checksum。
5. `verify` 檢查遠端資源、published state、Search Console URL Inspection，並送一筆 GA4 與 Mixpanel synthetic event。Clarity collect 必須用一次 GTM Preview 瀏覽器 session 確認。
6. `export` 產生被 Git 忽略的 sanitized bundle，供未來 Skill／SOP 使用。

## GTM Preview 的最後一次人工驗證

發布前在 GTM Preview 依序做：

1. 開首頁，確認 Google Tag、Clarity Initialization、Mixpanel Initialization 各觸發一次。
2. 輸入合法 URL、選職業、啟動研究。
3. 在 dataLayer 看見 `product_event`，且 `event_name` 與 `analytics/events.json` 一致。
4. 確認 GA4 DebugView、Clarity session 與 Mixpanel Live View 收到同名事件。
5. 開 `/admin`，確認所有 managed analytics tags 都不觸發。
6. 關閉頁面後讓 Worker 完成一筆研究，再確認 Mixpanel 收到 `research_completed` 與 `report_published`。

## SEO 驗證

- `/`、`/history`、`/reports/demo` 與已發布的 `/reports/:id` 為 `index,follow`。
- `/admin`、`/api`、`/jobs`、`/collection`、分享卡與不存在頁面為 `noindex,nofollow`。
- `robots.txt` 與 `sitemap.xml` 由 Worker 動態產生。
- 每個可索引頁都有 canonical、zh-TW／en hreflang、Open Graph、Twitter metadata 與 JSON-LD。
- 公開報告的初始 HTML 包含標題、摘要、框架與發布日期；不存在或隱藏報告直接回 404。

## 新增或修改事件

1. 先改 `analytics/events.json` 的事件與欄位描述。
2. 在產品程式碼只呼叫 `track()`，不可直接呼叫供應商 SDK。
3. Worker lifecycle 事件只呼叫 `trackWorkerEvent()`。
4. `pnpm analytics:plan` 檢查 GA dimensions、key events 與 Mixpanel schema 差異。
5. 依序 `apply`、GTM Preview、`publish`、`verify`。

禁止送 token、API key、capability、actor hash、原始表單內容、報告正文、完整錯誤 stack，以及可能帶敏感 query 的完整 URL。
