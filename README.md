# StructLab

SAP2000 S2K／F2K 基礎整合檢視器與案例資料庫。

本 repository 目前包含單檔案版的 **S2K＋F2K 基礎整合檢視器 V4.15.5**、可由 Visual
Studio 開啟的 Windows 原生 C＃桌面專案，以及可用來測試模型定義與分析結果匯入的 SAP2000
S2K 案例。瀏覽器版可直接執行；桌面版則以 WPF 與 C＃類別庫獨立實作，不載入 HTML。

## 內容

| 路徑 | 說明 |
| --- | --- |
| S2K_F2K_基礎整合檢視器_V4.15.5.html | 單檔案瀏覽器版檢視器，版本 V4.15.5 |
| StructLab.sln | Visual Studio 2022 解決方案 |
| StructLab.Core/ | .NET 8 C＃核心：S2K 解析、模型、斷面分類與載重彙整 |
| StructLab.Desktop/ | .NET 8 原生 WPF 桌面應用程式，不含 WebView2／HTML 執行環境 |
| 工務大樓/ | 工務大樓模型與分析結果案例 |
| PR B/ | PR B 模型與分析結果案例 |
| .gitattributes | 指定大型 S2K 檔案使用 Git LFS |

目前的成對案例如下：

- **工務大樓**
  - 工務大樓模型定義檔（2026-07-08 e 版）
  - 工務大樓分析結果檔（2026-07-08 e 版）
- **PR B**
  - S_PRB_REV A_251202-1_model definition.s2k
  - S_PRB_REV A_251202-1_analysis results.s2k

模型定義檔與分析結果檔應使用同一個模型版本。若兩者的節點、桿件、載重案例或
編號不一致，檢視器可能無法正確配對結果。

## 使用 Visual Studio 執行 C＃桌面版

### 1. 系統需求

桌面版是 Windows 的 WPF 應用程式，請使用 Windows 10／11 與 Visual Studio 2022。
安裝 Visual Studio Community 即可，不需要 Unity。於 Visual Studio Installer 的「工作負載」
選取 **.NET desktop development**，它會安裝建置 WPF 所需的 C＃與 .NET 工具；若 Visual
Studio 已安裝，可按「Modify」補裝這個工作負載。

官方操作參考：

- [安裝與修改 Visual Studio 工作負載](https://learn.microsoft.com/zh-tw/visualstudio/install/install-visual-studio?view=vs-2022)
- [Visual Studio 中的 .NET desktop development 工作負載](https://learn.microsoft.com/en-us/visualstudio/ide/quickstart-ide-orientation?view=vs-2022)

範例 S2K 檔以 Git LFS 儲存。若要下載完整案例，另請安裝 [Git LFS](https://git-lfs.com/)。

### 2. 取得 `c#-test-1` 分支

#### 方法 A：用 Git 指令列下載指定分支

開啟 PowerShell 或 Git Bash，執行：

~~~powershell
git lfs install
git clone --branch c#-test-1 --single-branch https://github.com/yunen1007/StructLab.git
cd StructLab
git lfs pull
git branch --show-current
~~~

最後一行應顯示 `c#-test-1`。此方式只下載目前 C＃遷移中的分支，不會變更 `main` 的內容。

#### 方法 B：完全使用 Visual Studio 下載

1. 開啟 Visual Studio，在起始畫面選擇「Clone a repository」。
2. 在 Repository location 貼上 `https://github.com/yunen1007/StructLab.git`，選擇本機資料夾後按「Clone」。
3. 開啟「Git」→「Manage Branches」，在遠端分支找到 `origin/c#-test-1`，按右鍵選擇「Checkout」。
4. 若 Git LFS 尚未下載案例，於該 repository 的終端機執行 `git lfs pull`。

Visual Studio 的 Git clone 官方說明請見[這裡](https://learn.microsoft.com/zh-tw/visualstudio/version-control/git-clone-repository?view=vs-2022)。

### 3. 開啟方案與建置

1. 在 Visual Studio 選擇「Open a project or solution」。
2. 選取 repository 根目錄的 `StructLab.sln`。
3. Solution Explorer 應可看到兩個專案：
   - `StructLab.Core`：S2K 解析與工程計算核心。
   - `StructLab.Desktop`：WPF 桌面使用者介面。
4. 在 `StructLab.Desktop` 按右鍵，選擇「Set as Startup Project」。
5. 按 `Ctrl`＋`Shift`＋`B` 建置方案。
6. 建置成功後按 `F5` 啟動偵錯，或按 `Ctrl`＋`F5` 啟動但不偵錯。

若出現缺少 .NET 或 Windows SDK 的錯誤，開啟 Visual Studio Installer，對目前安裝按「Modify」，
確認已選取 **.NET desktop development** 後重新建置。

### 4. 匯入範例模型並確認程式可執行

1. 在程式頂端按「匯入 S2K 檔案」。
2. 選擇模型定義檔，例如：
   - `工務大樓/工務大樓_20260708_e_model definition.s2k`。
   - `PR B/S_PRB_REV A_251202-1_model definition.s2k`。
3. 成功後可檢視：
   - 模型總覽中的節點與桿件資料。
   - 模型平面預覽中的 XY 線框。
   - 原始 S2K 表格與 CSV 匯出。
   - 台灣鋼結構斷面分類。
   - 重力載重彙整。

目前 C＃版讀取的是 **Model Definition S2K**。Analysis Results S2K、F2K／SAFE、基礎穩定、
柱墩 P-M、強柱弱梁、完整 3D 與 Excel 計算書尚在移植中，詳細狀態見 [MIGRATION.md](MIGRATION.md)。

### 5. 確認桌面版不依賴 HTML

`StructLab.Desktop.csproj` 只參考 `StructLab.Core.csproj`；它沒有 WebView2、HTML、JavaScript
或 CDN 依賴。C＃版執行時不會載入 `S2K_F2K_基礎整合檢視器_V4.15.5.html`。

在尚未完成所有模組的數值驗證前，請**不要刪除** HTML；它目前是原功能和計算結果的比對基準。
待 [MIGRATION.md](MIGRATION.md) 中所有項目完成且案例比對通過後，才適合從發行版本移除它。

## 使用瀏覽器執行舊版 HTML

若要使用目前功能最完整的舊版檢視器，可用 Chrome、Edge 或其他現代瀏覽器直接開啟：

~~~text
S2K_F2K_基礎整合檢視器_V4.15.5.html
~~~

此瀏覽器版與 C＃桌面版是獨立程式。舊版支援更多計算模組，但並不是 C＃移植版的執行依賴。

## 支援範圍

檢視器首頁標示支援 SAP2000 v9 及 v22～v27 的表格式文字檔，並包含 SAFE F2K、
載重描述匯入、台灣斷面分類、基礎穩定性與柱墩 P-M 等功能。實際可讀取的表格與
計算結果仍取決於輸入檔案的版本、匯出內容及模型資料完整性。

本工具是檔案檢視與案例驗證工具，不取代 SAP2000／SAFE 的正式分析、設計審查或
工程簽證；檢視結果不應單獨作為設計通過或施工依據。

## 公開資料注意事項

本 repository 為 Public。S2K 檔案可能包含工程名稱、模型幾何、設計參數、分析結果、
自訂斷面與原始匯出資訊。公開或轉發前，請確認已取得專案與公司授權，並檢查是否
需要移除專案識別資訊、內部路徑或其他敏感資料。

本 repository 目前沒有附加開源授權條款；未另行授權前，請勿將案例或檢視器視為
可任意再散布或用於商業設計的素材。

## 版本

- Viewer：V4.15.5
- 範例模型：主要為 SAP2000 27.1.0 匯出之 S2K
- 大型 S2K 檔案：Git LFS

## 回報問題

回報問題時，請一併提供：

- 檢視器版本
- SAP2000／SAFE 版本
- 使用的模型定義檔與分析結果檔名稱
- 發生問題的表格名稱或畫面
- 若可公開，附上最小化且已去識別化的案例

