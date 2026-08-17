namespace StructLab.Core.Models;

public sealed class StructuralModel
{
    public string Units { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public Dictionary<string, Joint> Joints { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<Frame> Frames { get; } = [];
    public List<Area> Areas { get; } = [];
    public Dictionary<string, FrameSection> FrameSections { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, AreaSection> AreaSections { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, Material> Materials { get; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, bool[]> Restraints { get; } = new(StringComparer.OrdinalIgnoreCase);
    public List<FrameLoad> FrameLoads { get; } = [];
    public List<AreaLoad> AreaLoads { get; } = [];
    public List<LoadPattern> LoadPatterns { get; } = [];
    public List<GridLine> GridLines { get; } = [];
}

public sealed class Joint
{
    public required string Id { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public double Z { get; init; }
}

public sealed class Frame
{
    public required string Id { get; init; }
    public required string JointI { get; init; }
    public required string JointJ { get; init; }
    public double Length { get; set; }
    public string? Section { get; set; }
    public string? DesignSection { get; set; }
    public double Angle { get; set; }
    public List<string> Groups { get; } = [];
}

public sealed class Area
{
    public required string Id { get; init; }
    public List<string> JointIds { get; } = [];
    public string? Section { get; set; }
}

public sealed class FrameSection
{
    public required string Name { get; init; }
    public string Material { get; init; } = string.Empty;
    public string Shape { get; init; } = "Rectangular";
    public double T3 { get; init; }
    public double T2 { get; init; }
    public double Tf { get; init; }
    public double Tw { get; init; }
    public double Area { get; init; }
}

public sealed class AreaSection
{
    public required string Name { get; init; }
    public string Material { get; init; } = string.Empty;
    public string Type { get; init; } = string.Empty;
    public double Thickness { get; init; }
}

public sealed class Material
{
    public required string Name { get; init; }
    public double UnitWeight { get; set; }
    public double Fy { get; set; }
    public double Fu { get; set; }
}

public sealed class FrameLoad
{
    public required string FrameId { get; init; }
    public string Pattern { get; init; } = string.Empty;
    public string Direction { get; init; } = "Gravity";
    public double ValueAtI { get; init; }
    public double ValueAtJ { get; init; }
}

public sealed class AreaLoad
{
    public required string AreaId { get; init; }
    public string Pattern { get; init; } = string.Empty;
    public string Direction { get; init; } = "Gravity";
    public double Value { get; init; }
}

public sealed record LoadPattern(string Name, string Type, double SelfWeightMultiplier);
public sealed record GridLine(string Direction, string Id, double Coordinate);
