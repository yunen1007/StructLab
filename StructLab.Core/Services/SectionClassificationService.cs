using StructLab.Core.Models;

namespace StructLab.Core.Services;

public sealed class SectionClassificationService
{
    private static readonly string[] Labels = ["塑性斷面", "結實斷面", "半結實斷面", "細長肢材斷面"];

    public IReadOnlyList<SectionClassification> ClassifyAll(StructuralModel model) =>
        model.FrameSections.Values.OrderBy(section => section.Name, StringComparer.OrdinalIgnoreCase).Select(section => Classify(model, section)).ToList();

    public SectionClassification Classify(StructuralModel model, FrameSection section)
    {
        if (!model.Materials.TryGetValue(section.Material, out var material) || material.Fy <= 0)
            return SectionClassification.NotApplicable(section.Name, section.Shape, "無鋼材 Fy 資料");

        var fy = material.Fy / 10000d;
        if (fy <= 0) return SectionClassification.NotApplicable(section.Name, section.Shape, "Fy 必須大於 0");
        var sqrtFy = Math.Sqrt(fy);
        var shape = section.Shape.ToUpperInvariant();
        var dimensions = new List<ElementClassification>();

        if (shape.Contains("I/") || shape.Contains("WIDE FLANGE") || shape == "I")
        {
            var d = section.T3 * 100d;
            var bf = section.T2 * 100d;
            var tf = section.Tf * 100d;
            var tw = section.Tw * 100d;
            if (d <= 0 || bf <= 0 || tf <= 0 || tw <= 0) return SectionClassification.NotApplicable(section.Name, "I/H 型", "斷面尺寸不足");
            var welded = section.Name.StartsWith("BH", StringComparison.OrdinalIgnoreCase) || section.Name.StartsWith("WH", StringComparison.OrdinalIgnoreCase) || section.Name.StartsWith("WELD", StringComparison.OrdinalIgnoreCase) || section.Name.StartsWith("BUILT", StringComparison.OrdinalIgnoreCase);
            var fr = welded ? 1.16 : 0.70;
            dimensions.Add(ClassifyElement("翼板 b／2tf", bf / (2 * tf), 14 / sqrtFy, 17 / sqrtFy, (welded ? 28 : 37) / Math.Sqrt(Math.Max(fy - fr, 1e-9))));
            dimensions.Add(ClassifyElement("腹板 h／tw", (d - 2 * tf) / tw, 138 / sqrtFy, 170 / sqrtFy, 260 / sqrtFy));
        }
        else if (shape.Contains("BOX") || shape.Contains("TUBE"))
        {
            var d = section.T3 * 100d;
            var b = section.T2 * 100d;
            var tf = section.Tf * 100d;
            var tw = section.Tw * 100d;
            if (d <= 0 || b <= 0 || tf <= 0 || tw <= 0) return SectionClassification.NotApplicable(section.Name, "箱型", "斷面尺寸不足");
            var fullPenetration = section.Name.StartsWith("BOX", StringComparison.OrdinalIgnoreCase);
            var plasticDesign = fullPenetration ? 45 : 30;
            dimensions.Add(ClassifyElement("翼板淨寬／tf", (b - 2 * tw) / tf, plasticDesign / sqrtFy, 50 / sqrtFy, 63 / sqrtFy));
            dimensions.Add(ClassifyElement("腹板淨深／tw", (d - 2 * tf) / tw, plasticDesign / sqrtFy, 50 / sqrtFy, 63 / sqrtFy));
        }
        else return SectionClassification.NotApplicable(section.Name, section.Shape, "未支援的斷面形狀");

        var rank = dimensions.Max(element => element.Rank);
        return new SectionClassification(section.Name, section.Material, section.Shape, true, Labels[rank], rank, fy, dimensions, string.Empty);
    }

    private static ElementClassification ClassifyElement(string name, double slenderness, double plasticDesign, double compact, double nonCompact)
    {
        var rank = slenderness <= plasticDesign ? 0 : slenderness <= compact ? 1 : slenderness <= nonCompact ? 2 : 3;
        return new ElementClassification(name, slenderness, plasticDesign, compact, nonCompact, Labels[rank], rank);
    }
}

public sealed record ElementClassification(string Name, double Slenderness, double PlasticDesignLimit, double CompactLimit, double NonCompactLimit, string Classification, int Rank);

public sealed record SectionClassification(string Section, string Material, string Shape, bool IsApplicable, string Classification, int Rank, double FyTfPerSquareCm, IReadOnlyList<ElementClassification> Elements, string Note)
{
    public static SectionClassification NotApplicable(string section, string shape, string note) => new(section, string.Empty, shape, false, "不適用", 99, 0, [], note);
    public string Detail => Elements.Count == 0 ? Note : string.Join("；", Elements.Select(element => $"{element.Name} λ={element.Slenderness:F2} → {element.Classification}"));
}
