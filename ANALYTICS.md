# Analytics Stack as Code

這份文件是 Skill Reverse 的一次性設定 SOP。日後要換帳號、加事件或複製到其他網站，以 `analytics/stack.json`、`analytics/events.json` 與 `scripts/analytics.mjs` 為準，不需要重新在四個後台逐項點選。

## 邊界

- 瀏覽器只有在使用者明確允許分析量測後，才建立 `window.dataLayer`、載入 GTM 並送出目前頁面的 `page_view`；同意前的操作不排隊、不補送。
- 拒絕或尚未選擇時，不載入 GA、Clarity 或 Mixpanel；`/admin` 與 `/api` 永遠排除。使用者可從全站導覽重新開啟隱私設定並撤回。
- GTM 只負責本次明確選定的瀏覽器供應商。GA4 是第一階段；Clarity 與 Mixpanel 仍保持未啟用，直到各自的隱私與 runtime gate 通過。
- Worker 的 Mixpanel 研究生命週期仍是未啟用設計；在伺服器端 consent 能被可靠傳遞與撤回前，不得填入 production `MIXPANEL_TOKEN`。
- Cloudflare 自動注入的 RUM beacon 是獨立的運作／效能遙測。依 Cloudflare 文件，它不使用瀏覽器儲存或跨站追蹤個人；edge request 與必要 operational logs 仍可能被處理，詳見 `/privacy`。
- 未知的遠端資源不刪除，`apply` 不發布，`publish` 永遠是獨立指令。
- `/privacy` 是資料透明說明，不宣稱法律合規；上線前仍應依實際營運地與使用者所在地做必要的法律檢查。

## 本次發布門檻

- 舊 production 的既有 GTM version 仍會在頁面載入時啟動 GA。發布新 managed tags 前，必須先部署本 branch 的 consent gate，或由站長明確授權暫停舊 GA tag。
- GA4／Search Console 可以先 `plan`；在 12 份報告回填完成前不執行正式 analytics `apply`，以遵守 release 順序。
- Clarity、Mixpanel browser 與 Worker lifecycle 不屬於本次第一階段發布。

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
2. Cookies 設為 Off，預設不在取得有效 consent signal 前寫入 cookies。
3. Masking 設為 Strict。
4. Bot detection 設為 On。
5. 確認 GTM initialization 使用 Consent API V2：`analytics_Storage=granted`、`ad_Storage=denied`，且不呼叫 Identify API、不建立自訂跨頁 ID。
6. 若需要資料匯出，再建立 Data Export API token；它只放密碼管理器或本機環境。

Clarity 沒有完整的 Project Admin API，所以以上 Project-level 設定仍是刻意保留的手動步驟。Project ID 留空時，Clarity provider 不可 apply 或 publish。

### 3. Mixpanel

1. 建立 Organization 與 Project。
2. 記下 Project ID、Project Token 與 region（`US`、`EU` 或 `IN`）。
3. 建立 Project Admin Service Account。
4. 立即把 username 與只顯示一次的 secret 放入密碼管理器。

即使帳號已建立，在瀏覽器與 Worker 的 consent boundary 完成前，`projectId`／`projectToken` 仍保持空白，也不在 production 設定 `MIXPANEL_TOKEN`。

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

只有未來完成 server-consent gate 並決定啟用 Worker lifecycle 時，Worker 才可讀取 `analytics/stack.json` 的 Project Token 與 region。需要部署時覆寫才設定：

```text
MIXPANEL_TOKEN=<analytics/stack.json 的 projectToken>
MIXPANEL_REGION=US
MIXPANEL_API_HOST=https://api.mixpanel.com
```

Project Token 不是管理憑證。Region 為 EU／IN 時 API host 分別改成 `https://api-eu.mixpanel.com`／`https://api-in.mixpanel.com`。

## 操作順序

```bash
pnpm analytics:plan -- --providers=ga4,search-console
pnpm analytics:apply -- --providers=ga4,search-console
pnpm analytics:plan -- --providers=ga4,search-console
pnpm analytics:publish -- --providers=ga4,search-console
pnpm analytics:verify -- --providers=ga4,search-console
pnpm analytics:export -- --providers=ga4,search-console
```

可選 provider 為 `ga4`、`clarity`、`mixpanel`、`search-console`。省略 `--providers` 代表完整 stack；正式操作應明確指定，避免因尚未設定的 provider 阻塞或誤納入發布。

1. `plan` 只讀遠端。帳號資料未填時會逐 provider 列出缺少項目，不建立資源。
2. `apply` 先把選定 provider 的遠端狀態存到被忽略的 `.analytics-backups/`，再 reconcile。它不刪除、不發布。
3. GTM／GA apply 開始前會先清除舊的 complete marker；GTM workspace 成功後保存 pending binding，所有同次選定 provider 都成功後才標記 complete。任何中途失敗都會讓 `publish` fail closed。
4. 第二次 `plan` 應全部顯示 `KEEP`。若出現 `UPDATE`，先檢查是否有人在 UI 改了 `[managed]` 資源。
5. `publish` 僅接受相同 manifest checksum 與完整 provider selection 的 complete apply；legacy state、pending apply、provider 不一致或 workspace conflict 都會停止。版本名稱包含 UTC 日期、Git commit 與 manifest checksum。
6. `verify` 檢查選定 provider 的遠端資源、published state 與 Search Console URL Inspection。若選了 GA4 或 Mixpanel，它會送 synthetic event；不要把 `verify` 當唯讀指令。
7. `export` 產生被 Git 忽略的 sanitized bundle，供未來 Skill／SOP 使用。

## GTM Preview 的最後一次人工驗證

發布前在乾淨瀏覽器 profile 與 GTM Preview 依序做：

1. 清除 consent key 與 vendor storage 後開首頁：banner 的接受／拒絕同等可見；尚未選擇時沒有 `dataLayer`、GTM script、GA request 或預先佇列。
2. 選擇拒絕：研究功能正常，重新整理後仍不載入 GTM／GA。
3. 改為接受：只送出目前頁面的 `page_view`，不補送接受前的點擊；後續事件才進入 `dataLayer`。
4. 輸入合法 URL、選職業、啟動研究；確認 `product_event.event_name` 與 `analytics/events.json` 一致，且 payload 沒有表單文字、提交的來源 URL、報告正文或 secret。
5. 確認 GA4 DebugView 收到一次頁面事件與同名產品事件；撤回後 vendor storage 可清除、頁面 reload，後續 request 停止。
6. 直接開 `/admin`，以及從 `/admin` 導回首頁：管理頁不觸發；回到允許的頁面後才初始化。
7. Clarity／Mixpanel 日後啟用時各自重跑 consent、masking、storage、revoke 與 live view 驗收，不能沿用 GA4 已通過的結論。

## SEO 驗證

- `/`、`/history`、`/privacy`、`/reports/demo` 與已發布的 `/reports/:id` 為 `index,follow`。
- `/admin`、`/api`、`/jobs`、`/collection`、分享卡與不存在頁面為 `noindex,nofollow`。
- `robots.txt` 與 `sitemap.xml` 由 Worker 動態產生。
- 每個可索引頁都有 canonical、zh-TW／en hreflang、Open Graph、Twitter metadata 與 JSON-LD。
- 公開報告的初始 HTML 包含標題、摘要、框架與發布日期；不存在或隱藏報告直接回 404。

## 新增或修改事件

1. 先改 `analytics/events.json` 的事件與欄位描述。
2. 在產品程式碼只呼叫 `track()`，不可直接呼叫供應商 SDK。
3. Worker lifecycle 事件只呼叫 `trackWorkerEvent()`。
4. 用明確的 `--providers` 執行 `analytics:plan`，檢查該 provider 的差異。
5. 依序 `apply`、GTM Preview、`publish`、`verify`。

禁止送 token、API key、capability、actor hash、原始表單內容、報告正文、完整錯誤 stack，以及可能帶敏感 query 的完整 URL。
