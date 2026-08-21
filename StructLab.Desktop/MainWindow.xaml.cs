using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Data;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Media3D;
using System.Windows.Threading;
using HelixToolkit.Geometry;
using HelixToolkit.SharpDX;
using HelixToolkit.Wpf.SharpDX;
using Microsoft.Win32;
using StructLab.Core.Models;
using StructLab.Core.Parsing;
using StructLab.Core.Services;
using StructLab.Desktop.Rendering;

namespace StructLab.Desktop;

public partial class MainWindow : Window, INotifyPropertyChanged
{
    private readonly S2kParser _parser = new();
    private readonly SectionClassificationService _classificationService = new();
    private readonly LoadSummaryService _loadSummaryService = new();
    private readonly RenderSceneBuilder _renderSceneBuilder = new();
    private readonly ScenePickingService _pickingService = new();
    private Dictionary<string, S2kTable> _tables = new(StringComparer.OrdinalIgnoreCase);
    private StructuralModel? _model;
    private RenderScene? _renderScene;
    private DataView _tableView = new DataTable().DefaultView;
    private LineGeometry3D? _frameGeometry;
    private LineGeometry3D? _areaGeometry;
    private PointGeometry3D? _jointGeometry;
    private LineGeometry3D? _selectionGeometry;
    private string? _selectedTableName;
    private string _fileName = "尚未匯入模型";
    private string _programVersion = "";
    private string _unitsLabel = "";
    private string _countsLabel = "";
    private string _selectedObjectDetails = "尚未選取桿件。";
    private string _statusMessage = "請匯入或拖入 SAP2000 匯出的 .s2k 檔案。";
    private string _tableSearch = string.Empty;

    public ObservableCollection<string> TableNames { get; } = [];
    public ObservableCollection<Joint> Joints { get; } = [];
    public ObservableCollection<Frame> Frames { get; } = [];
    public ObservableCollection<SectionClassification> SectionClassifications { get; } = [];
    public ObservableCollection<LoadSummaryRow> LoadSummaries { get; } = [];
    public IEffectsManager EffectsManager { get; } = new DefaultEffectsManager();
    public HelixToolkit.Wpf.SharpDX.PerspectiveCamera Camera { get; } = new()
    {
        Position = new Point3D(30, -30, 24),
        LookDirection = new Vector3D(-30, 30, -24),
        UpDirection = new Vector3D(0, 0, 1),
        NearPlaneDistance = 0.01,
        FarPlaneDistance = 1_000_000
    };

    public DataView TableView { get => _tableView; private set => SetField(ref _tableView, value, nameof(TableView)); }
    public LineGeometry3D? FrameGeometry { get => _frameGeometry; private set => SetField(ref _frameGeometry, value, nameof(FrameGeometry)); }
    public LineGeometry3D? AreaGeometry { get => _areaGeometry; private set => SetField(ref _areaGeometry, value, nameof(AreaGeometry)); }
    public PointGeometry3D? JointGeometry { get => _jointGeometry; private set => SetField(ref _jointGeometry, value, nameof(JointGeometry)); }
    public LineGeometry3D? SelectionGeometry { get => _selectionGeometry; private set => SetField(ref _selectionGeometry, value, nameof(SelectionGeometry)); }
    public string FileName { get => _fileName; private set => SetField(ref _fileName, value, nameof(FileName)); }
    public string ProgramVersion { get => _programVersion; private set => SetField(ref _programVersion, value, nameof(ProgramVersion)); }
    public string UnitsLabel { get => _unitsLabel; private set => SetField(ref _unitsLabel, value, nameof(UnitsLabel)); }
    public string CountsLabel { get => _countsLabel; private set => SetField(ref _countsLabel, value, nameof(CountsLabel)); }
    public string SelectedObjectDetails { get => _selectedObjectDetails; private set => SetField(ref _selectedObjectDetails, value, nameof(SelectedObjectDetails)); }
    public string StatusMessage { get => _statusMessage; private set => SetField(ref _statusMessage, value, nameof(StatusMessage)); }
    public string TableSearch { get => _tableSearch; set => SetField(ref _tableSearch, value, nameof(TableSearch)); }

    public event PropertyChangedEventHandler? PropertyChanged;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;
    }

    private async void OpenS2k_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "SAP2000 S2K (*.s2k;*.$2k)|*.s2k;*.$2k|所有檔案 (*.*)|*.*",
            Multiselect = false
        };
        if (dialog.ShowDialog(this) == true)
        {
            await LoadS2kAsync(dialog.FileName);
        }
    }

    private async Task LoadS2kAsync(string path)
    {
        try
        {
            StatusMessage = "正在背景解析 S2K 資料……";
            var stopwatch = Stopwatch.StartNew();
            var source = await File.ReadAllTextAsync(path);
            var result = await Task.Run(() =>
            {
                var tables = _parser.ParseTables(source);
                if (tables.Count == 0)
                {
                    throw new InvalidDataException("找不到任何 TABLE 資料表。請確認檔案為 SAP2000 表格式 S2K。");
                }

                var model = _parser.BuildModel(tables);
                if (model.Joints.Count == 0)
                {
                    throw new InvalidDataException("解析完成，但缺少 JOINT COORDINATES 資料表。");
                }

                return new ImportResult(
                    tables,
                    model,
                    _classificationService.ClassifyAll(model),
                    _loadSummaryService.Summarize(model),
                    _renderSceneBuilder.Build(model));
            });

            _tables = result.Tables;
            _model = result.Model;
            _renderScene = result.Scene;
            BindModel(path, result.Classifications, result.LoadSummaries);
            BuildGraphics(result.Scene);
            stopwatch.Stop();
            var skipped = result.Scene.SkippedFrames + result.Scene.SkippedAreas;
            var skippedLabel = skipped == 0
                ? string.Empty
                : $"；因缺少節點跳過桿件 {result.Scene.SkippedFrames:N0}、面元素 {result.Scene.SkippedAreas:N0}";
            StatusMessage = $"已完成 C＃解析與 GPU 場景建立：{FileName}，耗時 {stopwatch.Elapsed.TotalSeconds:F2} 秒{skippedLabel}。";
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                "無法匯入 S2K 檔案。\n\n" + exception.Message,
                "StructLab 匯入失敗",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            StatusMessage = "匯入失敗。";
        }
    }

    private void BindModel(
        string path,
        IReadOnlyList<SectionClassification> classifications,
        IReadOnlyList<LoadSummaryRow> loadSummaries)
    {
        var model = _model!;
        FileName = Path.GetFileName(path);
        ProgramVersion = string.IsNullOrWhiteSpace(model.Version) ? "未提供 SAP2000 版本資訊" : model.Version;
        UnitsLabel = $"單位：{(string.IsNullOrWhiteSpace(model.Units) ? "未提供" : model.Units)}";
        CountsLabel = $"節點 {model.Joints.Count:N0}　桿件 {model.Frames.Count:N0}　面元素 {model.Areas.Count:N0}　資料表 {_tables.Count:N0}";
        SelectedObjectDetails = "尚未選取桿件。";
        SelectionGeometry = null;
        Replace(Joints, model.Joints.Values.OrderBy(joint => joint.Id, StringComparer.OrdinalIgnoreCase));
        Replace(Frames, model.Frames.OrderBy(frame => frame.Id, StringComparer.OrdinalIgnoreCase));
        Replace(SectionClassifications, classifications);
        Replace(LoadSummaries, loadSummaries);
        TableNames.Clear();
        foreach (var name in _tables.Keys.OrderBy(name => name, StringComparer.OrdinalIgnoreCase))
        {
            TableNames.Add(name);
        }

        if (TableNames.Count > 0)
        {
            UpdateTable(TableNames[0], updateStatus: false);
        }
    }

    private void BuildGraphics(RenderScene scene)
    {
        FrameGeometry = HelixSceneAdapter.BuildLines(scene.FrameSegments);
        AreaGeometry = HelixSceneAdapter.BuildLines(scene.AreaEdges);
        JointGeometry = HelixSceneAdapter.BuildPoints(scene.Joints);
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () => ModelViewport.ZoomExtents());
    }

    private void Window_DragOver(object sender, DragEventArgs e)
    {
        e.Effects = TryGetDroppedS2k(e.Data, out _) ? DragDropEffects.Copy : DragDropEffects.None;
        e.Handled = true;
    }

    private async void Window_Drop(object sender, DragEventArgs e)
    {
        if (TryGetDroppedS2k(e.Data, out var path))
        {
            await LoadS2kAsync(path);
        }
    }

    private static bool TryGetDroppedS2k(IDataObject data, out string path)
    {
        path = string.Empty;
        if (!data.GetDataPresent(DataFormats.FileDrop) || data.GetData(DataFormats.FileDrop) is not string[] { Length: > 0 } files)
        {
            return false;
        }

        var candidate = files[0];
        var extension = Path.GetExtension(candidate);
        if (!extension.Equals(".s2k", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".$2k", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        path = candidate;
        return true;
    }

    private void FrameModel_MouseDown3D(object sender, MouseDown3DEventArgs e)
    {
        if (_renderScene is null || e.HitTestResult is null)
        {
            return;
        }

        var hit = e.HitTestResult.PointHit;
        var hitPoint = new ScenePoint(hit.X, hit.Y, hit.Z);
        var tolerance = Math.Max(_renderScene.Bounds.Diagonal * 0.01, 0.01);
        var selected = _pickingService.FindNearest(_renderScene.FrameSegments, hitPoint, tolerance);
        if (selected is null)
        {
            return;
        }

        SelectionGeometry = HelixSceneAdapter.BuildLines([selected]);
        var frame = _model?.Frames.FirstOrDefault(candidate => candidate.Id.Equals(selected.ObjectId, StringComparison.OrdinalIgnoreCase));
        SelectedObjectDetails = frame is null
            ? $"桿件：{selected.ObjectId}\n斷面：{selected.SectionName ?? "未指定"}"
            : $"桿件：{frame.Id}\n端點：{frame.JointI} → {frame.JointJ}\n斷面：{frame.Section ?? "未指定"}\n設計斷面：{frame.DesignSection ?? "未指定"}\n長度：{frame.Length:G6}\n局部軸角度：{frame.Angle:G6}";
        StatusMessage = $"已選取桿件 {selected.ObjectId}。";
    }

    private void FitView_Click(object sender, RoutedEventArgs e) => ModelViewport.ZoomExtents();
    private void IsometricView_Click(object sender, RoutedEventArgs e) => SetCameraView(new(1, -1, 0.8), new(0, 0, 1));
    private void TopView_Click(object sender, RoutedEventArgs e) => SetCameraView(new(0, 0, 1), new(0, 1, 0));
    private void FrontView_Click(object sender, RoutedEventArgs e) => SetCameraView(new(0, -1, 0), new(0, 0, 1));
    private void RightView_Click(object sender, RoutedEventArgs e) => SetCameraView(new(1, 0, 0), new(0, 0, 1));

    private void SetCameraView(Vector3D directionFromTarget, Vector3D upDirection)
    {
        if (_renderScene is null)
        {
            return;
        }

        directionFromTarget.Normalize();
        var center = _renderScene.Bounds.Center;
        var distance = Math.Max(_renderScene.Bounds.Diagonal * 1.5, 10);
        var target = new Point3D(center.X, center.Y, center.Z);
        var offset = directionFromTarget * distance;
        Camera.Position = target + offset;
        Camera.LookDirection = -offset;
        Camera.UpDirection = upDirection;
        ModelViewport.ZoomExtents();
    }

    private void TableSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string tableName })
        {
            _selectedTableName = tableName;
            UpdateTable(tableName);
        }
    }

    private void TableSearch_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (TableNames.Count > 0 && sender is TextBox textBox)
        {
            TableSearch = textBox.Text;
            UpdateTable(_selectedTableName ?? TableNames[0]);
        }
    }

    private void UpdateTable(string tableName, bool updateStatus = true)
    {
        if (!_tables.TryGetValue(tableName, out var table))
        {
            return;
        }

        var columns = table.Rows.SelectMany(row => row.Keys).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var output = new DataTable(tableName);
        foreach (var column in columns)
        {
            output.Columns.Add(column);
        }

        foreach (var row in table.Rows.Where(row => string.IsNullOrWhiteSpace(TableSearch) || row.Values.Any(value => value.Contains(TableSearch, StringComparison.OrdinalIgnoreCase))))
        {
            var dataRow = output.NewRow();
            foreach (var column in columns)
            {
                dataRow[column] = row.TryGetValue(column, out var value) ? value : string.Empty;
            }
            output.Rows.Add(dataRow);
        }

        TableView = output.DefaultView;
        if (updateStatus)
        {
            StatusMessage = $"資料表：{tableName}，顯示 {output.Rows.Count:N0}／{table.Rows.Count:N0} 列。";
        }
    }

    private void ExportTable_Click(object sender, RoutedEventArgs e)
    {
        if (TableView.Table.Columns.Count == 0)
        {
            return;
        }

        var dialog = new SaveFileDialog { Filter = "CSV 檔案 (*.csv)|*.csv", FileName = $"{TableView.Table.TableName}.csv" };
        if (dialog.ShowDialog(this) != true)
        {
            return;
        }

        var csv = new StringBuilder();
        csv.AppendLine(string.Join(',', TableView.Table.Columns.Cast<DataColumn>().Select(column => Csv(column.ColumnName))));
        foreach (DataRow row in TableView.Table.Rows)
        {
            csv.AppendLine(string.Join(',', TableView.Table.Columns.Cast<DataColumn>().Select(column => Csv(row[column]?.ToString() ?? string.Empty))));
        }

        File.WriteAllText(dialog.FileName, csv.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        StatusMessage = $"已匯出 CSV：{Path.GetFileName(dialog.FileName)}。";
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        if (EffectsManager is IDisposable disposable)
        {
            disposable.Dispose();
        }
    }

    private static string Csv(string value) => $"\"{value.Replace("\"", "\"\"")}\"";

    private static void Replace<T>(ObservableCollection<T> destination, IEnumerable<T> source)
    {
        destination.Clear();
        foreach (var item in source)
        {
            destination.Add(item);
        }
    }

    private void SetField<T>(ref T field, T value, string propertyName)
    {
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }

    private sealed record ImportResult(
        Dictionary<string, S2kTable> Tables,
        StructuralModel Model,
        IReadOnlyList<SectionClassification> Classifications,
        IReadOnlyList<LoadSummaryRow> LoadSummaries,
        RenderScene Scene);
}
