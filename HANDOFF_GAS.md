# GAS 部署與驗證交接

## 2026－09－08 接續驗證

目前工作分支為 `GAS-test`。此次沿用既有部署，未改動雲端程式、部署版本或權限。

- [Apps Script 編輯器](https://script.google.com/home/projects/1xlnebhgciL7poyzQzzCbX2x4dlwqF7aPs1G9zTcIKw0WyRh373Y57W1P/edit)
- [StructLab 試用入口](https://script.google.com/macros/s/AKfycbxmoUldcyhtiXr41nnlDxKDjtcuGVdvXLffTpSytgAzY7RtDXMPGm6Qh4tdtiua7AWl/exec)
- 管理部署畫面顯示第２版，建立時間為 2026 年 9 月 8 日下午 3：28，執行身分為部署者，存取為「所有人」。
- 編輯器已有 `Code.gs`、`LegacyCore.gs`、`Index.html`、`appsscript.json`。本次未逐字核對全部雲端原始碼，不宣稱與本機完全同步。

## 已實測

本機執行 `node --test tests/parity.test.cjs`，１０項全數通過，包括兩份工務大樓實檔與舊版算法比對。

Chrome 已登入工作階段開啟正式 `/exec` 網址，透過介面呼叫伺服器：

- 示範模型成功解析：８節點、８桿件、１面元素、１１資料表。
- H400 分類為塑性斷面；３公尺樓層 DL 為 13.2 tf；０與３公尺樓層桿件自重分別為 0.7716864、1.286144 tf，符合本機基準。
- P－M 使用預設斷面：B＝H＝60 cm、fc＝280、fy＝4200、Es＝2040000 kgf/cm²、Ab＝5.067 cm²、鋼筋中心距外緣＝6 cm、X／Y 每側４支、α＝1.5。

| Pu（tf） | Mux（tf·m） | Muy（tf·m） | 畫面互制比 | 判定 |
| --- | --- | --- | --- | --- |
| 100 | 10 | 5 | 0.06542924 | OK |
| 300 | 30 | 20 | 0.47558881 | OK |
| 10000 | 0 | 0 | 999 | NG，軸壓超限 |
| 0 | 0 | 0 | 0 | OK |
| -10000 | 0 | 0 | 999 | NG，軸拉超限 |

五組結果與本機基準在畫面顯示精度內一致，曲線與表格可見。999 是舊版超限哨兵值，不是實際互制比。

## 尚待驗證與接續步驟

尚未在登出／無痕環境驗證匿名訪客；「所有人」目前僅確認部署設定。尚未線上上傳實際工程模型，也未完成旋轉、點選、CSV／JSON 往返與行動版完整驗收。

後續先完成上述介面驗收，再依 `MIGRATION.md` 接續基礎穩定性等模組。工程案例上傳會將內容傳至 Google，應使用獲授權的案例。

維護來源為本機 `gas/` 四個檔案。更新時在編輯器逐檔同步並儲存，再於既有部署選擇新版本，保留既有入口網址；部署後重跑示範及 P－M 案例。不要將舊版 HTML、JS 或工程案例當作部署資產。

此工具不取代正式分析、設計審查或工程簽證。
