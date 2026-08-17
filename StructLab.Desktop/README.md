# StructLab.Desktop

這是供 Windows 使用的 WPF 桌面宿主。它以 Microsoft Edge WebView2 載入專案根目錄的
`S2K_F2K_基礎整合檢視器_V4.15.5.html`，所以既有的 S2K／F2K 匯入、3D、計算與 Excel
匯出功能會原樣保留。

## 在 Visual Studio 執行

1. 使用 Windows 的 Visual Studio 2022，安裝「.NET desktop development」工作負載。
2. 開啟根目錄的 `StructLab.sln`。
3. 將 `StructLab.Desktop` 設為啟始專案並按 `F5`。
4. 若電腦尚未安裝，依畫面提示安裝 Microsoft Edge WebView2 Runtime。

首次還原會透過 NuGet 下載 `Microsoft.Web.WebView2`。目前 HTML 仍從 CDN 載入 Three.js
與 xlsx-js-style，因此 3D 與 Excel 功能首次使用時需要網路；離線封裝是下一階段工作。

## 架構與後續 C＃遷移

目前採取「桌面宿主＋既有功能前端」的遷移方式，目的是先產出可執行的 Visual Studio
專案並避免改寫時改變工程計算結果。HTML 會在建置時複製到 `bin/.../Assets/index.html`。

建議接下來按下列界面抽離，不直接把 10,000 多行 JavaScript 一次翻寫：

1. 建立 `StructLab.Core` 類別庫：S2K／F2K 表格解析、資料模型、單位換算。
2. 將基礎穩定、柱墩 P-M、強柱弱梁等純計算移為可單元測試的 C＃服務。
3. 以 C＃服務輸出 DTO，前端逐頁改為 WPF 或 Blazor Hybrid；3D 視圖可保留 Three.js。
4. 將 Three.js 與 xlsx-js-style 改為受版本控制的本地資產，完成真正的離線部署。
