# StructLab.Desktop

這是供 Windows 使用的原生 WPF 桌面應用程式。它只參考 `StructLab.Core` C＃類別庫，
不使用 WebView2，也不會讀取、複製或執行專案根目錄的 HTML。

## 在 Visual Studio 執行

1. 使用 Windows 的 Visual Studio 2022，安裝「.NET desktop development」工作負載。
2. 開啟根目錄的 `StructLab.sln`。
3. 將 `StructLab.Desktop` 設為啟始專案並按 `F5`。
4. 按下「匯入 S2K 檔案」，選取 SAP2000 匯出的 `.s2k` 或 `.$2k` 檔案。

此專案沒有 WebView2、Three.js、xlsx-js-style 或 CDN 依賴；基本的 S2K 資料瀏覽可離線執行。

## 架構與後續 C＃遷移

`StructLab.Core` 是可測試、可供未來其他介面重用的程式核心。目前已移植 S2K 表格式
解析、模型資料建立、載重／材料讀取、台灣鋼結構斷面分類與重力載重彙整；桌面端以 WPF
原生呈現模型表格與 XY 平面線框。

建議接下來按下列界面抽離，不直接把 10,000 多行 JavaScript 一次翻寫：

1. 增加 F2K 解析與 SAFE 基礎資料模型。
2. 將基礎穩定、柱墩 P-M、強柱弱梁與層間位移各自移為 C＃計算服務，並以既有案例比對結果。
3. 以 WPF `Viewport3D` 取代目前的 XY 平面預覽，提供 3D、剖面、選取與圖例。
4. 為每個計算模組新增單元測試與 Excel 匯出服務。
