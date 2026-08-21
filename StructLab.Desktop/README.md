# StructLab.Desktop

這是供 Windows 使用的原生 WPF 桌面應用程式。它只參考 `StructLab.Core` C＃類別庫，
不使用 WebView2，也不會讀取、複製或執行專案根目錄的 HTML。

## 在 Visual Studio 執行

1. 使用 Windows 的 Visual Studio 2022，安裝「.NET desktop development」工作負載。
2. 開啟根目錄的 `StructLab.sln`。
3. 將 `StructLab.Desktop` 設為啟始專案並按 `F5`。
4. 按下「匯入 S2K 檔案」，選取 SAP2000 匯出的 `.s2k` 或 `.$2k` 檔案。

第一次建置會由 NuGet 依專案檔還原 `HelixToolkit.Wpf.SharpDX 3.1.2`。它提供原生
DirectX 11 GPU 3D，不會載入瀏覽器引擎。固定版本、測試套件及目前尚未還原的狀態見
根目錄的 `DEPENDENCIES.md`。

此專案沒有 WebView2、Three.js、xlsx-js-style、JavaScript、HTML 或 CDN 執行期依賴；完成
NuGet 還原後，S2K 資料瀏覽可離線執行。

## 架構與後續 C＃遷移

`StructLab.Core` 是可測試、可供未來其他介面重用的程式核心。目前已移植 S2K 表格式
解析、模型資料建立、載重／材料讀取、台灣鋼結構斷面分類、重力載重彙整與 3D 場景 DTO；
桌面端以 WPF 搭配 DirectX 11 原生呈現表格與合併式 GPU 線框。匯入會在背景執行，並支援
Windows 檔案拖放、相機操作與桿件點選。

建議接下來按下列界面抽離，不直接把 10,000 多行 JavaScript 一次翻寫：

1. 增加 F2K 解析與 SAFE 基礎資料模型。
2. 將基礎穩定、柱墩 P-M、強柱弱梁與層間位移各自移為 C＃計算服務，並以既有案例比對結果。
3. 延伸目前的 DirectX 11 線框雛形，提供樓層／群組篩選、剖面、面實體、圖例與結果彩圖。
4. 為每個計算模組新增單元測試與 Excel 匯出服務。

公司 Windows 電腦的第一輪編譯、手動操作及效能測試，請依根目錄
`HANDOFF_WINDOWS_3D.md` 執行並填寫結果。目前 macOS 環境沒有 .NET SDK，因此不能將此
原始碼狀態視為已建置或已執行通過。
