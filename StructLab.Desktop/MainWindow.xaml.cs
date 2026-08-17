using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace StructLab.Desktop;

public partial class MainWindow : Window
{
    private const string ViewerHost = "structlab.local";

    public MainWindow()
    {
        InitializeComponent();
    }

    private async void Window_ContentRendered(object? sender, EventArgs e)
    {
        try
        {
            await Viewer.EnsureCoreWebView2Async();

            var assetsDirectory = Path.Combine(AppContext.BaseDirectory, "Assets");
            var viewerPath = Path.Combine(assetsDirectory, "index.html");
            if (!File.Exists(viewerPath))
            {
                throw new FileNotFoundException("找不到檢視器前端檔案。請重新建置專案後再試。", viewerPath);
            }

            // Serve the existing HTML from a virtual HTTPS origin.  This avoids
            // file:// restrictions while retaining FileReader, drag/drop and
            // browser download behaviour used by the original viewer.
            Viewer.CoreWebView2.SetVirtualHostNameToFolderMapping(
                ViewerHost,
                assetsDirectory,
                CoreWebView2HostResourceAccessKind.Allow);

            Viewer.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            Viewer.CoreWebView2.Settings.AreDevToolsEnabled = true;
            Viewer.CoreWebView2.Settings.IsStatusBarEnabled = false;
            Viewer.CoreWebView2.Navigate($"https://{ViewerHost}/index.html");
            LoadingOverlay.Visibility = Visibility.Collapsed;
        }
        catch (Exception exception)
        {
            LoadingOverlay.Visibility = Visibility.Collapsed;
            MessageBox.Show(
                "無法啟動內建瀏覽器。請安裝 Microsoft Edge WebView2 Runtime，然後重新啟動程式。\n\n"
                + exception.Message,
                "StructLab 啟動失敗",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }
}
