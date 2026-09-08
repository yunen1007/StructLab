# StructLab GAS

此分支改為 Google Apps Script 網頁應用程式。工程算法在伺服器執行，瀏覽器負責輸入、３Ｄ線框與結果呈現。
**目前是 GAS 0.1.0 可部署試用版，尚未完整取代 V4.15.5。**

## 專案入口

- `gas/Code.gs`：網頁入口、公開 RPC、輸入限制、S2K／F2K 表格解析與資料驗證。
- `gas/LegacyCore.gs`：經比對的模型建立、四級斷面分類、載重彙整與柱墩 P－M 純計算；不送到瀏覽器。
- `gas/Index.html`：完整前端，包含 CSS、輸入表單、３Ｄ線框、圖表、CSV 與專案 JSON。
- `gas/appsscript.json`：V8、台北時區、公開訪客存取、零 OAuth scopes。
- [HANDOFF_GAS.md](HANDOFF_GAS.md)：部署網址、同步方法、實測結果與接手步驟。
- [MIGRATION.md](MIGRATION.md)：移植完成度及未完成清單。
- `tests/parity.test.cjs`：直接讀取舊版函式作為數值比對基準。

本機原始碼是維護來源。GAS 編輯器檔案須與 `gas/` 同名且內容一致。僅上傳這四個檔案至 Apps Script，**不要上傳舊版 HTML／JS、案例或測試程式**。

## 使用方式

[開啟 StructLab 試用版](https://script.google.com/macros/s/AKfycbxmoUldcyhtiXr41nnlDxKDjtcuGVdvXLffTpSytgAzY7RtDXMPGm6Qh4tdtiua7AWl/exec)。2026－09－08 已驗證既有第２版的示範模型與五組 P－M 線上計算；完整驗收範圍見交接檔。

開啟部署網址，先按「載入示範模型」，再匯入自己的 S2K／F2K。模型工作區支援旋轉、平移、縮放、平立面切換、樓層與斷面篩選、點選桿件。原始表格可搜尋、翻頁及下載 CSV。

「斷面與載重」自動呈現伺服器計算；目前工程計算限 `Tonf, m, C`。SAFE F2K 先支援幾何與表格，不假設單位換算或提供尚未完成的計算。

「柱墩 P－M」可獨立使用，尺寸 cm、材料強度 kgf/cm²、軸力 tf、彎矩 tf·m。`cover` 是鋼筋中心距外緣，並非淨保護層厚度。軸壓為正、軸拉為負。結果延續舊版算法，不包含柱細長效應與完整配筋細則。

專案以 JSON 下載至自己的電腦，保留模型文字與 P－M 輸入。重新開啟模型會呼叫伺服器重算，P－M 需按計算按鈕。伺服器不保存訪客資料。

## 本機驗證

需要 Node.js 22，沒有 npm 或 NuGet 相依套件：

```sh
node --test tests/parity.test.cjs
```

測試會讀取工務大樓兩份實際模型與保留的舊版 HTML／JS。若案例是 Git LFS 指標，需先取得實際檔案。舊版原始碼僅供本機回歸與後續移植，不是部署資產。

## 存取與原始碼保護

使用者指定開放「所有人」，因此此版沒有白名單或登入要求。公開訪客能呼叫計算，不能透過網頁讀取 `.gs` 檔案。瀏覽器介面和回傳結果仍可查看；這是前後端分離的正常界線。

**若你把 `gas/*.gs` 推到公開 Git repository，算法也會公開，GAS 無法保護 Git 裡的副本。** 私有 branch 並非一般 GitHub 公開 repository 的保密機制；要保護原始碼，應使用私有 repository，並限制 GAS 專案編輯權。

此程式不呼叫 Drive、Sheets、Gmail 或其他帳戶服務，沒有持久化、共享模型清單或對外 fetch。本程式不設定模型／專案檔案大小、資料列或幾何數量上限；實際容量仍受 GAS 執行時間、傳輸及瀏覽器記憶體影響，並非無限容量。公開使用仍會消耗部署帳戶的 Apps Script 配額。

Google 代管可減少自架主機維護，但不是全面防攻擊保證。官方參考：[Web Apps](https://developers.google.com/apps-script/guides/web)、[配額](https://developers.google.com/apps-script/guides/services/quotas)、[私有伺服器函式](https://developers.google.com/apps-script/guides/html/communication#private_functions)。

本工具不取代正式分析、設計審查或工程簽證。
