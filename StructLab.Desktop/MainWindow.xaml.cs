using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Data;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using Microsoft.Win32;
using StructLab.Core.Models;
using StructLab.Core.Parsing;
using StructLab.Core.Services;

namespace StructLab.Desktop;

public partial class MainWindow : Window
{
    private readonly S2kParser _parser = new();
    private readonly SectionClassificationService _classificationService = new();
    private readonly LoadSummaryService _loadSummaryService = new();
    private Dictionary<string, S2kTable> _tables = new(StringComparer.OrdinalIgnoreCase);
    private StructuralModel? _model;
    private DataView _tableView = new DataTable().DefaultView;
    private string? _selectedTableName;
    private string _fileName = "尚未匯入模型";
    private string _programVersion = "";
    private string _unitsLabel = "";
    private string _countsLabel = "";
    private string _statusMessage = "請匯入 SAP2000 匯出的 .s2k 檔案。";
    private string _tableSearch = string.Empty;

    public ObservableCollection<string> TableNames { get; } = [];
    public ObservableCollection<Joint> Joints { get; } = [];
    public ObservableCollection<Frame> Frames { get; } = [];
    public ObservableCollection<SectionClassification> SectionClassifications { get; } = [];
    public ObservableCollection<LoadSummaryRow> LoadSummaries { get; } = [];
    public DataView TableView { get => _tableView; private set { _tableView = value; OnPropertyChanged(nameof(TableView)); } }
    public string FileName { get => _fileName; private set { _fileName = value; OnPropertyChanged(nameof(FileName)); } }
    public string ProgramVersion { get => _programVersion; private set { _programVersion = value; OnPropertyChanged(nameof(ProgramVersion)); } }
    public string UnitsLabel { get => _unitsLabel; private set { _unitsLabel = value; OnPropertyChanged(nameof(UnitsLabel)); } }
    public string CountsLabel { get => _countsLabel; private set { _countsLabel = value; OnPropertyChanged(nameof(CountsLabel)); } }
    public string StatusMessage { get => _statusMessage; private set { _statusMessage = value; OnPropertyChanged(nameof(StatusMessage)); } }
    public string TableSearch { get => _tableSearch; set { _tableSearch = value; OnPropertyChanged(nameof(TableSearch)); } }

    public event PropertyChangedEventHandler? PropertyChanged;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;
    }

    private void Window_Loaded(object sender, RoutedEventArgs e) => DrawPlan();

    private async void OpenS2k_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Filter = "SAP2000 S2K (*.s2k;*.$2k)|*.s2k;*.$2k|所有檔案 (*.*)|*.*", Multiselect = false };
        if (dialog.ShowDialog(this) != true) return;
        try
        {
            StatusMessage = "正在以 C＃解析 S2K 資料……";
            var source = await File.ReadAllTextAsync(dialog.FileName);
            _tables = _parser.ParseTables(source);
            if (_tables.Count == 0) throw new InvalidDataException("找不到任何 TABLE 資料表。請確認檔案為 SAP2000 表格式 S2K。 ");
            _model = _parser.BuildModel(_tables);
            if (_model.Joints.Count == 0) throw new InvalidDataException("解析完成，但缺少 JOINT COORDINATES 資料表。 ");
            BindModel(dialog.FileName);
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

    private void BindModel(string path)
    {
        var model = _model!;
        FileName = Path.GetFileName(path);
        ProgramVersion = string.IsNullOrWhiteSpace(model.Version) ? "未提供 SAP2000 版本資訊" : model.Version;
        UnitsLabel = $"單位：{(string.IsNullOrWhiteSpace(model.Units) ? "未提供" : model.Units)}";
        CountsLabel = $"節點 {model.Joints.Count:N0}　桿件 {model.Frames.Count:N0}　面元素 {model.Areas.Count:N0}　資料表 {_tables.Count:N0}";
        Replace(Joints, model.Joints.Values.OrderBy(joint => joint.Id, StringComparer.OrdinalIgnoreCase));
        Replace(Frames, model.Frames.OrderBy(frame => frame.Id, StringComparer.OrdinalIgnoreCase));
        Replace(SectionClassifications, _classificationService.ClassifyAll(model));
        Replace(LoadSummaries, _loadSummaryService.Summarize(model));
        TableNames.Clear();
        foreach (var name in _tables.Keys.OrderBy(name => name, StringComparer.OrdinalIgnoreCase)) TableNames.Add(name);
        if (TableNames.Count > 0) UpdateTable(TableNames[0]);
        DrawPlan();
        StatusMessage = $"已完成 C＃解析：{FileName}。";
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

    private void UpdateTable(string tableName)
    {
        if (!_tables.TryGetValue(tableName, out var table)) return;
        var columns = table.Rows.SelectMany(row => row.Keys).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var output = new DataTable(tableName);
        foreach (var column in columns) output.Columns.Add(column);
        foreach (var row in table.Rows.Where(row => string.IsNullOrWhiteSpace(TableSearch) || row.Values.Any(value => value.Contains(TableSearch, StringComparison.OrdinalIgnoreCase))))
        {
            var dataRow = output.NewRow();
            foreach (var column in columns) dataRow[column] = row.TryGetValue(column, out var value) ? value : string.Empty;
            output.Rows.Add(dataRow);
        }
        TableView = output.DefaultView;
        StatusMessage = $"資料表：{tableName}，顯示 {output.Rows.Count:N0}／{table.Rows.Count:N0} 列。";
    }

    private void ExportTable_Click(object sender, RoutedEventArgs e)
    {
        if (TableView.Table.Columns.Count == 0) return;
        var dialog = new SaveFileDialog { Filter = "CSV 檔案 (*.csv)|*.csv", FileName = $"{TableView.Table.TableName}.csv" };
        if (dialog.ShowDialog(this) != true) return;
        var csv = new StringBuilder();
        csv.AppendLine(string.Join(',', TableView.Table.Columns.Cast<DataColumn>().Select(column => Csv(column.ColumnName))));
        foreach (DataRow row in TableView.Table.Rows) csv.AppendLine(string.Join(',', TableView.Table.Columns.Cast<DataColumn>().Select(column => Csv(row[column]?.ToString() ?? string.Empty))));
        File.WriteAllText(dialog.FileName, csv.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        StatusMessage = $"已匯出 CSV：{Path.GetFileName(dialog.FileName)}。";
    }

    private void PlanCanvas_SizeChanged(object sender, SizeChangedEventArgs e) => DrawPlan();

    private void DrawPlan()
    {
        PlanCanvas.Children.Clear();
        if (_model is null || PlanCanvas.ActualWidth < 10 || PlanCanvas.ActualHeight < 10) return;
        var joints = _model.Joints.Values.ToList();
        var minX = joints.Min(joint => joint.X); var maxX = joints.Max(joint => joint.X);
        var minY = joints.Min(joint => joint.Y); var maxY = joints.Max(joint => joint.Y);
        var scale = Math.Min((PlanCanvas.ActualWidth - 40) / Math.Max(maxX - minX, 1), (PlanCanvas.ActualHeight - 40) / Math.Max(maxY - minY, 1));
        Point Project(Joint joint) => new(20 + (joint.X - minX) * scale, PlanCanvas.ActualHeight - 20 - (joint.Y - minY) * scale);
        foreach (var frame in _model.Frames)
        {
            if (!_model.Joints.TryGetValue(frame.JointI, out var start) || !_model.Joints.TryGetValue(frame.JointJ, out var end)) continue;
            var a = Project(start); var b = Project(end);
            PlanCanvas.Children.Add(new Line { X1 = a.X, Y1 = a.Y, X2 = b.X, Y2 = b.Y, Stroke = Brushes.SteelBlue, StrokeThickness = 1.5, ToolTip = $"桿件 {frame.Id}：{frame.Section}" });
        }
        foreach (var joint in joints)
        {
            var point = Project(joint);
            var marker = new Ellipse { Width = 4, Height = 4, Fill = Brushes.DarkSlateGray, ToolTip = $"節點 {joint.Id}（{joint.X:F2}, {joint.Y:F2}, {joint.Z:F2}）" };
            PlanCanvas.Children.Add(marker);
            Canvas.SetLeft(marker, point.X - 2);
            Canvas.SetTop(marker, point.Y - 2);
        }
    }

    private static string Csv(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
    private static void Replace<T>(ObservableCollection<T> destination, IEnumerable<T> source) { destination.Clear(); foreach (var item in source) destination.Add(item); }
    private void OnPropertyChanged(string propertyName) => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
