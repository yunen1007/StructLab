# StructLab 相依套件與目前缺少項目

更新日期：2026-08-22

## 本次環境狀態

本次開發環境是 macOS，且依使用者指示，**沒有安裝 .NET SDK、Visual Studio、NuGet 套件或
其他新工具，也沒有執行 `dotnet restore`**。目前程式碼是依套件公開 API 編寫，必須到公司
Windows 電腦完成還原、建置與執行驗證。

## Windows 必要環境

| 項目 | 要求 | 目前 Mac 狀態 | Windows 用途 |
| --- | --- | --- | --- |
| Visual Studio | Visual Studio 2022 17.x | 未安裝 | 開啟、建置及偵錯 WPF 專案 |
| 工作負載 | `.NET desktop development` | 未安裝 | WPF 與 C＃桌面建置工具 |
| .NET SDK | .NET 8 SDK | 未安裝；`dotnet` 指令不存在 | 建置 `net8.0` 與 `net8.0-windows` |
| DirectX | DirectX 11 相容顯示卡與驅動程式 | 未驗證 | 原生 GPU 3D 場景 |
| Git LFS | 能取得完整案例時才需要 | 未新增安裝 | 還原大型 S2K 案例；不屬於程式執行期相依性 |

## NuGet 直接相依套件

下列參考已寫入專案檔，但本次**沒有下載或還原**：

| 專案 | 套件 | 版本 | 用途 |
| --- | --- | --- | --- |
| `StructLab.Desktop` | `HelixToolkit.Wpf.SharpDX` | `3.1.2` | WPF 原生 DirectX 11 3D、相機操作與 GPU 幾何繪製 |
| `StructLab.Core.Tests` | `Microsoft.NET.Test.Sdk` | `17.12.0` | Visual Studio／`dotnet test` 測試執行器 |
| `StructLab.Core.Tests` | `xunit` | `2.9.2` | Core 單元測試框架 |
| `StructLab.Core.Tests` | `xunit.runner.visualstudio` | `2.8.2` | Visual Studio Test Explorer 配接器 |

`HelixToolkit.Wpf.SharpDX` 所需的 `HelixToolkit.SharpDX`、`HelixToolkit.Geometry`、
`HelixToolkit.Maths` 等傳遞相依套件，應由 NuGet 依 `3.1.2` 套件描述自動還原，不應另外手動
加入不同版本。

## Windows 還原指令

在 repository 根目錄執行：

~~~powershell
dotnet restore StructLab.sln
dotnet build StructLab.sln -c Debug
dotnet test StructLab.sln -c Debug --no-build
~~~

第一次還原需要連線到 NuGet 套件來源。若公司網路封鎖 NuGet，先保留完整錯誤訊息並確認
公司代理伺服器或離線套件來源，不要任意降版或改成 WebView2。

## 不可加入的執行期相依性

此 C＃遷移不得加入 WebView2、Three.js、JavaScript 引擎、HTML 載入器或 CDN。舊 HTML 只能
作為人工比對基準，不可成為桌面程式執行期資產。
