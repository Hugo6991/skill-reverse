# Skill Evals Workshop Concierge 訪談包

日期：2026-08-06

場域：Skill Evals Workshop @ Taipei

目的：驗證 Skill Reverse 是否能幫助使用者在安裝前做出更清楚的 `install / try / skip` 決定。

這不是銷售話術、產品滿意度調查，也不是對參與者的 Skill 能力測驗。每次訪談只觀察一件事：參與者帶來一個原本正在猶豫的公開 Skill URL，看完報告後，決定是否改變，以及哪一項具體證據造成改變。

## 現場目標與停止條件

- 完成 5–8 次一對一觀察。
- 收集最多 10 個合格的公開 URL。
- 至少取得 3 個符合本文驗收條件的 `decision-changed` session。
- 若連續 3 位參與者無法理解首頁承諾、`install / try / skip` 或公開發布提醒，先停止招募並記錄共同摩擦，不要靠口頭補充把流程硬帶完。
- 不替任何人註冊服務、安裝 Skill、聯絡作者或執行外部發布。

## 訪談前準備

- 正式站首頁已開啟：<https://skill-reverse.vibeencode.dev/?lang=zh-TW>。
- 備用既有報告已開啟：<https://skill-reverse.vibeencode.dev/reports/2aab5061-f2c3-48ae-97da-8cf63a24a98b?lang=zh-TW>。
- 手機與筆電都能開站；網路中斷時只展示既有報告，不偽裝成完整新研究。
- 每位參與者使用匿名代碼：`P01`、`P02`……，不在這份表記姓名、Email、電話、帳號或公司內部資訊。
- 記錄者只寫觀察到的行為與參與者原話；推論另標「研究者推論」。
- 只有參與者明確同意後才做 24 小時 follow-up；聯絡方式存放在其同意的私人管道，不寫進本文件。

## 公開 URL 與隱私提醒

在貼入 URL 前必須逐字說明：

> 接下來只能使用任何人不需登入就能開啟的公開 HTTPS 網址。你送出的網址、完成報告與保存的證據會進入永久公開成果庫。請不要使用 private repo、公司內網、未公開文件、客戶資料、含存取 token 的網址，或任何不希望被搜尋到的內容。你可以換一個網址，也可以隨時停止，不需要提供聯絡方式。這份報告是採用研究，不是安全掃描、作者背書或安裝保證。

貼入前由訪談者快速確認：

- [ ] URL 以 `https://` 開頭，無需登入即可讀取。
- [ ] URL query、fragment 或 path 不含 token、Email、客戶／專案代號等敏感資訊。
- [ ] 參與者理解研究結果會永久公開。
- [ ] 參與者知道可換 URL 或停止，且不影響參與活動。

任一項未通過：不要送出 URL。

## 5 分鐘開場腳本

### 0:00–0:45｜說明目的

> 我正在測一個叫 Skill Reverse 的工具。它不是幫 Skill 排名，也不是做 security scan；它想回答的是：安裝之前，能不能先看懂這套 Skill 在解什麼問題、哪些方法不用安裝也能先試，以及它是否適合你的工作。今天測的是產品，不是測你。整段大約 12–15 分鐘。

### 0:45–1:30｜提出任務

> 請想一個你最近看過、曾考慮使用，但還沒有完全決定要不要安裝的 Skill、repo 或方法來源。最好是你真的有工作情境會用到，而不是為了配合訪談臨時找一個。

如果對方沒有真實候選，停止這次 session，將其記為「無當前採用任務」，不要提供示範 URL 代替他的決策。

### 1:30–2:15｜宣讀公開與隱私提醒

使用上一節逐字提醒，等參與者明確表示理解後才繼續。

### 2:15–3:30｜鎖定 pre-decision

> 在看 Skill Reverse 之前，如果現在就必須選，你會 `install`、`try`，還是 `skip`？你有多確定，1 到 5 分？你現在主要靠什麼做這個判斷？

先寫下答案，不接受「看完再說」。若真的無法選，記為 `unresolved`；這次 session 仍可觀察，但不能算 `decision-changed`。

### 3:30–4:15｜交還操作權

> 接下來請你自己操作。我不會解釋按鈕或告訴你該看哪裡。請把你腦中正在想的事說出來；如果卡住，也先說你原本預期會發生什麼。

除非遇到無法繼續的技術錯誤，訪談者不指路、不替選職業、不替解讀分數。

### 4:15–5:00｜設定觀察方式

> 研究進行時，我只會記錄你先看哪裡、哪裡讓你停下來，以及你最後根據什麼做決定。沒有標準答案。如果報告不足以決定，直接說不足就好。

開場結束後進入自由操作與 post-decision 訪談。

## 決策定義

三個選項以「下一個真實行動」區分，不以喜歡程度或分數區分。

### `install`

參與者決定把 Skill、plugin 或其檔案加入實際 agent／專案環境，並願意承擔設定、權限與維護成本。收藏、開著分頁或只下載報告不算 install。

記錄時要有具體下一步，例如：「今晚把它加進專案級 `.agents/skills/`，先跑既有 eval。」

### `try`

參與者暫時不安裝，而是會在一個真實任務中，先使用報告提煉的 chat-first 提示、判斷規則或手動流程做有限試跑。只有「之後可能看看」不算 try。

記錄時要有試跑任務與時間，例如：「本週用 portable framework 重做一次 PR review，再比較原流程。」

### `skip`

參與者目前不安裝也不試跑，原因可以是問題不相關、證據不足、依賴或風險過高、已有更合適流程，或投入不值得。Skip 是有效決策，不代表產品失敗。

記錄時要有理由，例如：「核心價值依賴我沒有的服務，且報告沒有足夠可重現證據，因此本月不採用。」

### `unresolved`（只作研究標記）

資訊仍不足，參與者無法選擇上述任一行動。它不是第四種採用決策，也不能計入 `decision-changed`；必須記錄缺少什麼資訊。

## Pre-decision 問題

在參與者看到任何 Skill Reverse 報告前完成：

1. 你原本想用這套 Skill 解哪一個真實任務？
2. 你第一次在哪裡看到它？
3. 你目前看過哪些材料：README、原始碼、作者背景、stars、安裝數、評測、討論或實際 demo？
4. 如果現在必須選，你的決定是 `install / try / skip` 哪一個？
5. 確定程度是 1–5 分中的幾分？
6. 目前支持這個決定的最重要理由是什麼？
7. 還缺哪一項資訊，最可能讓你改變決定？

禁止在 pre-decision 階段介紹報告特色或暗示「正確」答案。

## 操作中只觀察、不引導

記錄以下行為；除非參與者主動詢問，不要追問到打斷操作：

- 首先注意首頁的哪一句話或哪一個元素。
- 是否理解需要選擇工作情境；如何挑選。
- 是否注意到永久公開提醒；有沒有停頓或改 URL。
- 等待研究時做什麼；是否理解進度與預期時間。
- 報告開啟後先看 verdict、框架、六維畫像、職業差異或證據。
- 是否主動展開 evidence、開啟來源或複製 chat-first 內容。
- 哪個詞、分數或主張造成困惑或不信任。
- 是否把「聲量／作者名氣」誤認成 claim 真實性。
- 是否把報告誤認成 security audit。

若訪談者不得不協助，逐字記下參與者的問題與提供的最小協助；該步驟不能再算自然完成。

## Post-decision 問題

參與者自行表示看完，或已瀏覽主要報告區塊後再問：

1. 如果現在必須選，你會 `install / try / skip` 哪一個？
2. 確定程度現在是 1–5 分中的幾分？
3. 決定有沒有改變？請先用自己的話說原因。
4. 報告中的哪一個具體段落、claim、證據或缺口影響最大？請直接指出位置。
5. 有哪一項內容你不相信、看不懂或仍需要自行查證？
6. 下一個具體行動是什麼？何時做？
7. 公開 URL／永久成果庫是否讓你改用別的網址，或不願研究某些內容？
8. 如果只能保留一個輸出，你會保留 verdict、portable framework、職業差異、證據，還是畫像？為什麼？
9. 你會把這份報告傳給誰？若不會，原因是什麼？
10. 是否同意我在 24 小時內用你指定的管道追問一次實際行動？不同意完全沒關係。

## 單次觀察紀錄表

每位參與者複製一份。原話加引號；未觀察到就填 `未觀察`，不要推測。

| 欄位 | 紀錄 |
|---|---|
| Participant code | P__ |
| 開始／結束時間 |  |
| 自述工作情境 |  |
| 公開 target URL |  |
| 想完成的真實任務 |  |
| 首次發現來源 |  |
| 既有判斷材料 |  |
| Pre-decision | install / try / skip / unresolved |
| Pre-confidence | 1 / 2 / 3 / 4 / 5 |
| Pre-decision 主要理由（原話） |  |
| 最可能改變決定的缺失資訊 |  |
| 公開／隱私確認 | 通過 / 換 URL / 停止 |
| 首頁首先注意 |  |
| 首個卡點 |  |
| 是否需要訪談者協助 | 否 / 是：__ |
| 工作情境選擇行為 |  |
| 等待期間行為／預期 |  |
| 報告首先查看 |  |
| 主動開啟的 evidence／來源 |  |
| 最大困惑或不信任 |  |
| Post-decision | install / try / skip / unresolved |
| Post-confidence | 1 / 2 / 3 / 4 / 5 |
| 影響決定的具體報告內容 |  |
| 下一個具體行動與時間 |  |
| Decision outcome | changed / clarified / unchanged / unresolved |
| 是否通過全部 decision-changed 驗收 | 否 / 是 |
| 最值得保留的輸出 |  |
| 分享意圖與對象 |  |
| 24h follow-up 同意 | 否 / 是；管道另存 |
| 參與者關鍵原話 |  |
| 研究者推論（須標示） |  |

## 10 URLs Tracker

只填公開 URL；`Suggested by` 只用匿名 participant code。Report ID 是公開識別碼，不記 capability token。

| # | Status | Public URL | Skill／來源 | Suggested by | 工作視角 | Pre | Report ID／link | Post | Outcome | 具體影響證據 | Follow-up |
|---:|---|---|---|---|---|---|---|---|---|---|---|
| 1 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 2 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 3 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 4 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 5 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 6 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 7 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 8 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 9 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |
| 10 | candidate / submitted / completed / failed |  |  | P__ |  |  |  |  |  |  |  |

## `decision-changed` 驗收條件

單一 session 必須同時通過以下三項，才可計為 `decision-changed`：

1. **基準有效**：參與者在看到報告前，已選定 `install / try / skip` 其中一項並說明理由；`unresolved` 不能作為 changed 的 pre-decision。
2. **行動類別真的改變**：post-decision 與 pre-decision 不同，例如 `install → try`、`try → skip`。只有 confidence 分數改變、理由變多或覺得報告有趣，均記為 `decision-clarified`，不算 changed。
3. **因果與下一步可驗證**：參與者能指出報告中的具體內容或缺失如何造成改變，並說出符合新決定的下一個真實行動與時間。若改變來自現場他人建議、訪談者解釋或會場新資訊，不算產品造成的 changed。

活動驗收目標是 **3 位不同參與者各自通過全部三項**；不能用同一人三個 URL 重複計數。

## 活動後 24 小時 Follow-up

只傳給在現場明確同意 follow-up 的參與者。不要群發、不要要求貼文或背書，也不要把未公開聯絡資料轉存到成果庫。

### 個人訊息模板

> 嗨，謝謝你昨天願意用 `{skill_name}` 幫我測 Skill Reverse。這是你的公開報告：{report_url}
>
> 我現場記到你原本的決定是 `{pre_decision}`，看完後是 `{post_decision}`；影響最大的是 `{specific_evidence_or_gap}`。若我記錯，請直接更正。
>
> 你當時說下一步會在 `{timeframe}` 做 `{next_action}`。想確認兩件事：你後來有執行嗎？實際行動後，決定仍然一樣嗎？一句話回覆即可。
>
> 這次追問只用於改善產品，不會公開你的身份或這段對話；如果不想再收到訊息，不需回覆，我也不會繼續聯絡。

### Follow-up 回收欄位

| Participant | 原定下一步 | 是否執行 | 實際結果 | 決定是否維持 | 更正／新阻礙 | 不再聯絡 |
|---|---|---|---|---|---|---|
| P__ |  | 是 / 否 |  | 是 / 否 / 未回覆 |  | 是 / 否 |

## 活動後 30 分鐘收斂

活動結束後先完成，不急著改產品：

1. 計算完成 session、合格 URL、自然完成率與四種 outcome 數量。
2. 將卡點分成：承諾不清、隱私、輸入、工作視角、等待、報告理解、信任、下一步。
3. 只把至少出現兩次的問題列為 pattern；單一回饋保留為 observation。
4. 分開統計 `decision-changed`、`decision-clarified`、`unchanged`、`unresolved`。
5. 寫下最強反證：哪一位目標使用者即使看完完整報告仍得不到採用價值，以及原因。

### Event summary

| 指標 | 結果 |
|---|---:|
| 招募人數 |  |
| 完成 session |  |
| 合格公開 URLs |  |
| 無協助自然完成 |  |
| Decision-changed |  |
| Decision-clarified |  |
| Unchanged |  |
| Unresolved |  |
| 同意 24h follow-up |  |
| 已完成 24h follow-up |  |

最常出現的兩個卡點：

1. （待填）
2. （待填）

最強 decision-changing 證據：

- （待填）

最強反證：

- （待填）
