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

## 快速開始

### 1. 下載 repository

S2K 案例使用 Git LFS 儲存。使用 Git clone 時，請先安裝並啟用 Git LFS：

~~~
git lfs install
git clone https://github.com/yunen1007/StructLab.git
cd StructLab
git lfs pull
~~~

若只想使用檢視器，也可以直接下載並開啟 HTML 檔案。

### 2. 開啟檢視器

使用 Chrome、Edge 或其他現代瀏覽器開啟：

~~~
S2K_F2K_基礎整合檢視器_V4.15.5.html
~~~

檢視器是單一 HTML 檔案，不需要啟動本機伺服器或執行建置指令。

### 2.1 在 Visual Studio 執行 Windows 桌面版

1. 在 Windows 安裝 Visual Studio 2022 的「.NET desktop development」工作負載。
2. 開啟 `StructLab.sln`，將 `StructLab.Desktop` 設為啟始專案。
3. 按 `F5` 建置並啟動，並按「匯入 S2K 檔案」選取模型。

桌面版不會載入 HTML。已完成 S2K 表格式解析、模型資料檢視、XY 平面預覽、台灣鋼結構
斷面分類與重力載重彙整的 C＃實作；其餘原始 HTML 的工程計算模組會持續以 C＃服務逐項移植與驗證。

### 3. 載入案例

1. 將 **Model Definition S2K** 拖放到首頁，或按一下檔案區選取。
2. 等待模型、載重與表格完成解析。
3. 在計算模組中匯入對應的第二個 **Analysis Results S2K**。
4. 依需要檢視 3D 模型、表格、載重、桿件結果、柱底反力、層間位移與基礎／柱墩計算。

檢視器目前以 Tonf, m, °C 作為主要顯示單位。若匯出的 S2K 單位不符，建議先在
SAP2000 內切換到正確單位後重新匯出，不要直接以文字修改數值。

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

