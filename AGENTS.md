# StructLab 協作交接指示

## 專案目標

將 `S2K_F2K_基礎整合檢視器_V4.15.5.html` 的功能逐步移植為可在 Visual Studio 中建置與
執行的原生 C＃桌面軟體。最終驗收標準是：即使刪除 HTML，C＃專案仍可完整執行所有既有
功能，且以相同案例輸入時，數值結果與原工具一致。

HTML 目前只能作為功能、公式與數值的**比對基準**，不可被 C＃專案載入、複製、嵌入或以
WebView2 呼叫。不要用「WPF／WebView2 外殼」宣稱功能已移植完成。

## 分支與協作範圍

- 目前 C＃遷移工作在 `c#-test-1` 分支進行。
- 不要直接修改 `main`，也不要覆蓋、刪除或改寫原始 HTML，除非使用者明確授權。
- 先執行 `git status -sb`；若工作目錄有非本次任務的修改，保留它們且不要混入提交。
- 完成一個可驗證的模組後再提交。提交訊息須清楚描述模組，例如：`Port foundation stability service`。

## 現行專案結構

| 路徑 | 用途 |
| --- | --- |
| `StructLab.sln` | Visual Studio 解決方案。 |
| `StructLab.Core/` | .NET 8 跨介面 C＃核心；放置解析器、資料模型與純計算服務。 |
| `StructLab.Desktop/` | .NET 8 Windows WPF 原生桌面程式；只處理 UI、檔案選取與結果呈現。 |
| `StructLab.Core.Tests/` | Core 場景與計算服務的 .NET 8 單元測試。 |
| `MIGRATION.md` | 移植完成度與模組優先順序的唯一狀態清單；功能變更時必須同步更新。 |
| `DEPENDENCIES.md` | SDK、NuGet 版本、未還原狀態與 Windows 必要環境。 |
| `HANDOFF_WINDOWS_3D.md` | 原生 3D 雛形的 Windows 建置、測試、風險與效能交接日誌。 |
| `S2K_F2K_基礎整合檢視器_V4.15.5.html` | 舊版行為參考與數值比對來源，不是 C＃執行期資產。 |
| `工務大樓/`、`PR B/` | 用於解析與計算結果比對的實際 S2K 案例。大型檔案使用 Git LFS。 |

`StructLab.Desktop.csproj` 只應有 `StructLab.Core.csproj` 專案參考。原生 GPU 3D 使用
`HelixToolkit.Wpf.SharpDX 3.1.2` NuGet 套件。不要加入 WebView2、Three.js、JavaScript、
HTML 或 CDN 相依性。

## 已完成的 C＃移植範圍

以下功能已由 C＃程式實作，但尚未在目前環境中以 .NET SDK 實際建置驗證：

- S2K `TABLE` 表格式解析與續行紀錄合併：`StructLab.Core/Parsing/S2kParser.cs`。
- 節點、桿件、面元素、斷面、材料、支承、載重、格線資料模型：`StructLab.Core/Models/`。
- S2K 模型建立、材料與載重資料讀取。
- 台灣鋼結構四級斷面分類：`Services/SectionClassificationService.cs`。
- 面載重、桿件分布載重與桿件自重彙整：`Services/LoadSummaryService.cs`。
- WPF 的 S2K 按鈕／拖放匯入、背景解析、原始資料表瀏覽與 CSV 匯出：`StructLab.Desktop/MainWindow.*`。
- 原生 DirectX 11 GPU 線框、相機視角與桿件點選雛形：`RenderSceneBuilder`、
  `ScenePickingService`、`HelixSceneAdapter` 與 `MainWindow.*`。目前尚待 Windows 還原、
  建置與手動效能驗證，詳見 `HANDOFF_WINDOWS_3D.md`。

不要把「已完成」理解為 HTML 所有功能已移植。完整差距必須以 `MIGRATION.md` 為準。

## 下一步優先順序

依下列順序移植，並在每一項完成後更新 `MIGRATION.md`：

1. F2K／SAFE 解析與基礎資料模型。
2. 基礎穩定性與柱墩 P-M 計算。
3. 強柱弱梁、梁柱交會區、柱基版、續接、剪力釘等檢核。
4. Analysis Results S2K 解析、層間位移、耐震、風載與構件比較。
5. 原生 3D、平立面、圖例、篩選與點選屬性。
6. Excel 計算書、專案儲存、彙整報表與 PDF。

若使用者指定其他模組，以使用者優先順序為準。

目前使用者已指定先完成並在公司 Windows 電腦驗證原生 3D 雛形。下一位 agent 應先依
`HANDOFF_WINDOWS_3D.md` 處理實際編譯錯誤與手動驗收，再回到上述功能順序。

## 實作規範

- 純資料處理與工程計算必須放在 `StructLab.Core`，不可耦合 WPF 控制項。
- UI 只呼叫 Core 服務並顯示 DTO／結果；避免將公式或 S2K 解析邏輯寫入 `MainWindow.xaml.cs`。
- 新增模組時，使用明確模型名稱、SI／Tonf 單位欄位與不可變或受控的輸入物件；不要將單位假設隱藏在 UI 字串中。
- 對照 HTML 時，逐段人工轉譯邏輯與例外處理；不要直接把 JavaScript 當字串嵌入或動態執行。
- 解析器須同時考慮 SAP2000 v9 與 v22～v27 的表名或欄位差異，並對缺欄位提供可理解的錯誤訊息。
- 新增外部 NuGet 套件前，先確認它確實取代原生難以維護的功能，並在 README 說明用途與版本。

## 驗證規範

工程計算不可只檢查「能執行」。每個新模組至少應完成：

1. 使用 `工務大樓/` 或 `PR B/` 的最小可公開案例建立輸入。
2. 記錄原 HTML 的輸入、輸出、單位與判定結果。
3. 建立 C＃單元測試，至少涵蓋一般值、零值、缺資料與 NG 邊界。
4. 將 C＃輸出與原 HTML 對照，說明允許誤差與任何差異。
5. 在 Windows 上以 Visual Studio 或 `dotnet build StructLab.sln` 建置，並手動測試對應 WPF 頁面。
6. 更新 `MIGRATION.md`、README 與本檔的「已完成範圍」。

目前共同工作環境未安裝 .NET SDK，不能把「尚未建置」誤報成「已測試通過」。需要建置時，
應在 Windows 的 Visual Studio 2022，安裝 `.NET desktop development` 工作負載後執行。

## 使用者溝通偏好

- 使用繁體中文回覆時，一律使用全形標點符號；英文內容使用半形標點符號。
- 直接說明結果、限制、驗證狀態與下一步；避免「沒問題！」、「當然可以！」等客套開場。
- 要求程式碼時，可指出應修改的段落與原因，不必預設貼出整個檔案。
- 不要過度使用表情符號。
- 涉及工程設計的結論，必須保留「不取代正式分析、設計審查或工程簽證」的界線。
