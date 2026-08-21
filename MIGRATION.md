# HTML 至 C＃原生程式遷移清單

`S2K_F2K_基礎整合檢視器_V4.15.5.html` 保留在 repository，僅用於驗證既有行為和比對數值。
`StructLab.Desktop` 不會載入、複製或執行該檔案。

## 已由 C＃實作

| 功能 | 實作位置 | 驗證方式 |
| --- | --- | --- |
| S2K TABLE 格式解析與續行合併 | `StructLab.Core/Parsing/S2kParser.cs` | 匯入範例模型，確認資料表數與內容 |
| 節點、桿件、面元素、斷面、材料、支承、載重、格線資料模型 | `S2kParser.BuildModel` | 對照 SAP2000 匯出的表格 |
| 原始表格檢視與 CSV 匯出 | `StructLab.Desktop/MainWindow` | 選取任一 TABLE 並匯出 |
| 原生 DirectX 11 線框雛形 | `RenderSceneBuilder`、`HelixSceneAdapter`、`MainWindow` | Windows 匯入後檢查 3D／俯視／前視／右視、旋轉、平移與縮放；待實測 |
| S2K 拖放、背景解析與桿件點選 | `MainWindow.LoadS2kAsync`、`ScenePickingService` | Windows 拖入 S2K、點選並核對屬性；待實測 |
| 台灣鋼結構四級斷面分類 | `Services/SectionClassificationService.cs` | 以原 HTML 的相同斷面與 Fy 比對 |
| 面載重、桿件分布載重與桿件自重彙整 | `Services/LoadSummaryService.cs` | 對照原工具的樓層載重試算 |

上述原生 3D 程式已完成原始碼雛形，但目前 macOS 沒有 .NET SDK，且未依賴還原套件，不能
列為已建置或已執行通過。Windows 接手與驗收細節見 `HANDOFF_WINDOWS_3D.md`。

## 尚待逐項移植

| 優先順序 | 模組 | C＃目標 |
| --- | --- | --- |
| 1 | F2K／SAFE 匯入與基礎疊圖 | `F2kParser`、基礎資料模型與 WPF 編輯器 |
| 2 | 基礎穩定性與柱墩 P-M | 純計算服務＋單元測試＋原生輸入／結果頁 |
| 3 | 強柱弱梁、梁柱交會區、柱基版、續接與剪力釘 | 各條文獨立計算服務＋批次結果表 |
| 4 | 層間位移、耐震、風載與構件比較 | 分析結果 S2K 解析＋檢核服務 |
| 5 | 補完 3D、平立面篩選、圖例與點選屬性 | 目前已有 GPU 線框與桿件點選雛形；尚缺樓層／群組篩選、圖例、面實體與結果彩圖 |
| 6 | Excel 多工作表計算書與專案儲存 | C＃匯出服務與專案檔格式 |
| 7 | 彙整計算書與 PDF 列印 | WPF 文件／報表輸出 |

## 移植原則

每個計算服務先以既有 S2K 案例建立輸入與預期輸出，再完成 C＃實作。只有數值、單位與
例外條件均比對通過後，才將該 HTML 模組視為可替換；這能避免結構設計計算在重寫時產生
未察覺的差異。

## 目前特別驗證順位

使用者於 2026-08-22 指定先驗證 C＃原生 3D 的效能與基本互動，因此 Windows 第一輪應先依
`HANDOFF_WINDOWS_3D.md` 建置、測試與填寫效能紀錄；完成雛形修正後，再回到上表的 F2K／
SAFE 與工程計算移植順序。
