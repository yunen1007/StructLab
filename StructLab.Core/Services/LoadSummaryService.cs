using StructLab.Core.Models;

namespace StructLab.Core.Services;

public sealed class LoadSummaryService
{
    public IReadOnlyList<LoadSummaryRow> Summarize(StructuralModel model)
    {
        var rows = new Dictionary<(double Elevation, string Pattern), LoadSummaryRow>();
        foreach (var load in model.AreaLoads.Where(load => IsGravity(load.Direction)))
        {
            var area = model.Areas.FirstOrDefault(area => area.Id.Equals(load.AreaId, StringComparison.OrdinalIgnoreCase));
            if (area is null) continue;
            var size = PolygonArea(area.JointIds.Select(id => model.Joints.TryGetValue(id, out var joint) ? joint : null).Where(joint => joint is not null).Cast<Joint>().ToList());
            Add(rows, Elevation(area, model), load.Pattern, size * load.Value, "面載重");
        }
        foreach (var load in model.FrameLoads.Where(load => IsGravity(load.Direction)))
        {
            var frame = model.Frames.FirstOrDefault(frame => frame.Id.Equals(load.FrameId, StringComparison.OrdinalIgnoreCase));
            if (frame is null) continue;
            Add(rows, FrameElevation(frame, model), load.Pattern, frame.Length * (load.ValueAtI + load.ValueAtJ) / 2d, "桿件分布載重");
        }
        foreach (var frame in model.Frames)
        {
            if (frame.Section is null || !model.FrameSections.TryGetValue(frame.Section, out var section) || !model.Materials.TryGetValue(section.Material, out var material) || material.UnitWeight == 0) continue;
            Add(rows, FrameElevation(frame, model), "Self Weight", frame.Length * section.Area * material.UnitWeight, "桿件自重");
        }
        return rows.Values.OrderBy(row => row.Elevation).ThenBy(row => row.Pattern, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static void Add(IDictionary<(double, string), LoadSummaryRow> rows, double elevation, string pattern, double value, string source)
    {
        var key = (Math.Round(elevation, 3), pattern);
        if (!rows.TryGetValue(key, out var row)) rows[key] = row = new LoadSummaryRow(key.Item1, pattern, 0, source);
        row.Value += value;
        row.Source = row.Source.Contains(source, StringComparison.Ordinal) ? row.Source : $"{row.Source}＋{source}";
    }

    private static bool IsGravity(string direction) => direction.Equals("Gravity", StringComparison.OrdinalIgnoreCase) || direction.Equals("GlobalZ", StringComparison.OrdinalIgnoreCase) || direction.Equals("Z", StringComparison.OrdinalIgnoreCase);
    private static double Elevation(Area area, StructuralModel model) => area.JointIds.Select(id => model.Joints.TryGetValue(id, out var joint) ? joint.Z : 0).DefaultIfEmpty().Average();
    private static double FrameElevation(Frame frame, StructuralModel model) => Math.Min(model.Joints.TryGetValue(frame.JointI, out var i) ? i.Z : 0, model.Joints.TryGetValue(frame.JointJ, out var j) ? j.Z : 0);
    private static double PolygonArea(IReadOnlyList<Joint> joints)
    {
        if (joints.Count < 3) return 0;
        var twiceArea = joints.Select((joint, index) => joint.X * joints[(index + 1) % joints.Count].Y - joints[(index + 1) % joints.Count].X * joint.Y).Sum();
        return Math.Abs(twiceArea) / 2d;
    }
}

public sealed class LoadSummaryRow(double elevation, string pattern, double value, string source)
{
    public double Elevation { get; } = elevation;
    public string Pattern { get; } = pattern;
    public double Value { get; set; } = value;
    public string Source { get; set; } = source;
}
