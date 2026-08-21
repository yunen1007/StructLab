# Windows 原生 3D 雛形交接日誌

更新日期：2026-08-22  
工作分支：`c#-test-1`

## 本輪目標與結果

本輪先完成可送到公司 Windows 電腦測試的原生 C＃垂直雛形。它沒有開啟、嵌入或執行
HTML／JavaScript，也沒有使用 WebView2。主要路徑如下：

1. 使用按鈕或 Windows 檔案拖放匯入 `.s2k`／`.$2k`。
2. 以背景工作執行既有 C＃ S2K 解析、模型建立、斷面分類、載重彙整與顯示場景轉換。
3. 將所有桿件、面元素邊界與節點分別合併為少量 GPU 幾何資料，不再為每根桿件建立一個
   WPF `Line` 控制項。
4. 使用 `HelixToolkit.Wpf.SharpDX 3.1.2` 的 DirectX 11 視窗提供旋轉、平移、縮放、填滿視窗、
   3D／俯視／前視／右視。
5. 點選桿件後，以 Core 的距離服務找出桿件，將它標成黃色並顯示端點、斷面、設計斷面、
   長度與局部軸角度。
6. 新增 Core 單元測試，涵蓋正常場景、空模型、缺節點、點選距離、零長度與錯誤容許距離。

## 主要異動檔案

| 檔案 | 內容 |
| --- | --- |
| `StructLab.Core/Models/RenderScene.cs` | 與 UI 無關的點、線段、邊界與物件類型 DTO |
| `StructLab.Core/Services/RenderSceneBuilder.cs` | `StructuralModel` 到 3D 場景的轉換及缺資料統計 |
| `StructLab.Core/Services/ScenePickingService.cs` | 3D 點至線段距離與最近桿件判定 |
| `StructLab.Desktop/Rendering/HelixSceneAdapter.cs` | Core DTO 到 Helix GPU 幾何的唯一配接層 |
| `StructLab.Desktop/MainWindow.xaml` | 原生 3D 視窗、視角按鈕、選取結果與拖放介面 |
| `StructLab.Desktop/MainWindow.xaml.cs` | 背景匯入、GPU 場景綁定、相機與選取互動 |
| `StructLab.Core.Tests/` | 場景建立與點選服務的 xUnit 測試 |
| `DEPENDENCIES.md` | 未安裝／未還原項目、版本與 Windows 還原指令 |

## 目前驗證狀態

已在 macOS 完成的只有靜態檢查：XML 可解析、Git 差異沒有空白錯誤、Core 與 WPF 的責任分層、
以及沒有新增 HTML／JavaScript／WebView2 執行路徑。

本機 `dotnet` 指令不存在，且使用者指定不得安裝或下載，因此下列項目**尚未驗證，不能宣稱
已通過**：

- NuGet restore。
- C＃編譯與 XAML 編譯。
- xUnit 測試執行。
- DirectX 11 視窗啟動。
- 實際 S2K 的拖放、相機、點選與效能。

套件與版本完整清單見 `DEPENDENCIES.md`。

## 公司 Windows 電腦接手步驟

### 一、確認檔案不是 Git LFS 指標

優先測試：

~~~text
工務大樓/工務大樓_20260708_e_model definition.s2k
~~~

正常檔案約為數 MB。若開頭是下列文字，它仍是 LFS 指標，不能當 S2K 解析：

~~~text
version https://git-lfs.github.com/spec/v1
~~~

有 Git LFS 時可執行：

~~~powershell
git lfs pull
~~~

### 二、還原、建置與測試

~~~powershell
dotnet restore StructLab.sln
dotnet build StructLab.sln -c Debug
dotnet test StructLab.sln -c Debug --no-build
~~~

也可用 Visual Studio 2022 開啟 `StructLab.sln`，將 `StructLab.Desktop` 設為啟始專案，再依序
執行「Build Solution」、「Run All Tests」與 `F5`。所需工作負載與套件見 `DEPENDENCIES.md`。

### 三、若第一輪編譯失敗

先保留完整的第一個錯誤及其後相關錯誤。最可能需要核對的是 HelixToolkit 3.1.2 的命名空間
或 XAML 屬性，例如 `LineGeometry3D`、`PointGeometry3D`、`MouseDown3DEventArgs`、
`HitTestThickness`、`BackgroundColor`、`PointGeometryModel3D.Size`。本輪已依 3.1.2 官方文件
撰寫，但因沒有還原套件，仍須以 Windows 實際編譯結果為準。

修正原則：只調整 Helix 配接層或 XAML API 差異，不要把 Core 場景服務移進 UI，也不要改用
WebView2、HTML 或 JavaScript。若 3.1.2 與程式不符，先查套件實際 API，再做最小修正；不要
未經記錄便改套件版本。

## 手動驗收清單

- [ ] 程式可啟動，3D 頁面沒有黑屏或 DirectX 例外。
- [ ] 用「匯入 S2K 檔案」可讀取工務大樓模型。
- [ ] 從檔案總管把同一 `.s2k` 拖入主視窗也可匯入。
- [ ] 匯入期間視窗仍能移動，沒有長時間顯示「未回應」。
- [ ] 節點、桿件、面元素與資料表數量合理，且警告的跳過數量可解釋。
- [ ] 3D 線框可旋轉、平移及滾輪縮放，操作時沒有明顯輸入延遲。
- [ ] 「3D 視角」、「俯視」、「前視」、「右視」與「填滿視窗」可用。
- [ ] 點選桿件後黃色高亮與左側屬性是同一桿件。
- [ ] 原始資料表、CSV、斷面分類與載重彙整仍可操作。
- [ ] 關閉程式後沒有殘留 StructLab 程序。
- [ ] 在執行輸出目錄移走舊 HTML，程式仍可啟動並完成上述功能。

## 效能紀錄方式

請在同一台公司電腦、同一個工務大樓案例記錄：

| 項目 | 第一輪實測 |
| --- | --- |
| `dotnet build` 結果 | 待填 |
| 單元測試通過／總數 | 待填 |
| 匯入至出現 3D 的秒數 | 待填；程式狀態列也會顯示 |
| 旋轉／縮放主觀延遲 | 待填 |
| Windows 工作管理員記憶體 | 待填 |
| 顯示卡與驅動版本 | 待填 |
| 任何 DirectX／Helix 例外 | 待填 |

若線框仍延遲，先量測桿件線段數、面邊數、節點數與 GPU 型號，再評估場景分塊、視錐剔除、
節點顯示開關或背景建立 GPU 資料；不要在沒有量測前回到逐物件 WPF 控制項。

## 尚未包含的功能

這是第一版原生 3D 雛形，不代表 HTML 已完整移植。目前仍沒有 F2K／SAFE、Analysis Results、
完整結構檢核、樓層／群組篩選、圖例、面元素實體顯示、結果彩圖、Excel／PDF 與專案儲存。
唯一狀態清單仍以 `MIGRATION.md` 為準。

工程數值與判定仍須逐案例和原 HTML／正式分析結果比對。本工具不取代正式分析、設計審查或
工程簽證。
