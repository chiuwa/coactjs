# Coact.js：一般方式理解

Coact.js 是「瀏覽器上的共同工作桌面」。每個 tab 都是一位參與者，能看到彼此的滑鼠，移動同一組視窗、修改儲存格，或者共同編輯圖片框。

現在的套件分成幾個入口：

| 入口 | 做什麼 |
| --- | --- |
| `coactjs` | 瀏覽器元件、滑鼠／視窗／框／儲存格 API、鎖及衝突事件 |
| `coactjs/server` | Node 的房間 server；需要額外安裝可選的 `ws` |
| `coactjs/worker` | Cloudflare Worker + 每個房間一個 Durable Object |
| `npx coactjs` | 啟動套件附帶的小例子，開第二個 tab 就可試共同修改 |

完整 demo 的工具列、Excel 畫面、公式、匯入匯出仍在 repository；它使用同一個 library。npm 套件沒有 SheetJS，也沒有幫你建立登入服務。

## 改一格時發生什麼

Alice focus B2，先申請編輯鎖。Server 批出、畫面同步最新內容後才開放輸入。她的修改帶著版本及 request id，server 再驗證權限、鎖和版本，接納後回 ACK 並通知其他人。Bob 可以同時改 C2。Alice 離開輸入位置後，等尚未完成的修改確認，再釋放鎖；斷線或到期也會釋放。

兩個人根據同一舊版本改 B2，先接納的一方成功，另一方收到衝突和正式資料。被拒絕的內容交回應用當草稿；不會自動蓋掉別人的新修改。Demo 可以 Copy draft，並限制只保留最近一批草稿，避免一直佔 RAM。

新 tab 和 reload 先拿取現況，不會重設房間。切換到全新房間則使用那個房間自己的預設內容。每個 tab 有獨立身份及顏色。

## Node 和 Worker 有什麼不同

Node 版本把房間放在記憶體，適合本機、prototype 或接自己的儲存服務。Server restart 會失去記憶體內容；沒有人使用的房間預設十分鐘後清除。

Cloudflare 不能靠普通 request Worker 裏的全域變數，保證所有人都看到同一份房間。因此我們讓一個 Durable Object 協調一個房間，正式修改寫入 SQLite；滑鼠移動只廣播，不寫內容資料庫。暫時沒有活動時可以休眠，再從儲存和連線 metadata 還原。預設無人使用一小時後清除房間，並不是永久檔案備份。

## 怎樣控制 RAM 和壓力

每個房間、連線及瀏覽器都有不同上限：文件大小、活動紀錄、快取、待送修改、人數和傳送量都有預算。快取只保留小型的請求結果，不保存幾百份完整文件。

如果某人的網路太慢、一直沒有確認收到資料，server 會在待確認資料超過上限時中止該連線，避免無限累積。正常 browser 會自動批次確認，應用不必自己寫這段。

Worker 預設一房最多 16 人。人數增加時，滑鼠廣播接近人數平方成長，所以「可以接很多連線」不代表「所有人全速移動也沒有成本」。你的應用保存的圖片、undo、Excel parser 或大量事件紀錄，同樣要自己設上限；SDK 不能控制整個應用的 RAM。

實測方法和數字見 [資源說明](docs/resources.md)。Node 測到的 heap 不等於 Cloudflare isolate 或整個瀏覽器的總 RAM。

## 安裝後適合做什麼

協作白板、設計 review room、共同規劃、互動工作台或內部 dashboard。你提供視窗內容與業務邏輯，元件處理共同動作。視窗裏任意 HTML／textarea 不會自動變成協同文件；完整多人編輯 Excel／Word 仍要自己的文件模型、儲存和合併方案。

圖片功能產生示意佔位圖。真正生成圖片、圖檔上傳和永久儲存，需要自己的 API／object storage。Activity 記錄誰改過什麼，但有保留上限，也不能靠它還原整份檔案。

0.5.1 目前是本機候選版，這次工作未發佈 npm。可以先裝 `.tgz` 加 `ws`，再用 `npx coactjs` 試用；Cloudflare 範例則跟套件一起提供，方便複製到自己的專案。

[README](README.md) · [權限／安全邊界](SECURITY.md) · [協定](docs/protocol.md)
