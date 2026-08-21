namespace StructLab.Core.Models;

public enum StructuralObjectKind
{
    Frame,
    Area
}

public readonly record struct ScenePoint(double X, double Y, double Z);

public sealed record SceneLineSegment(
    StructuralObjectKind Kind,
    string ObjectId,
    ScenePoint Start,
    ScenePoint End,
    string? SectionName = null);

public sealed record SceneBounds(ScenePoint Minimum, ScenePoint Maximum)
{
    public ScenePoint Center => new(
        (Minimum.X + Maximum.X) / 2,
        (Minimum.Y + Maximum.Y) / 2,
        (Minimum.Z + Maximum.Z) / 2);

    public double Diagonal => Math.Sqrt(
        Math.Pow(Maximum.X - Minimum.X, 2) +
        Math.Pow(Maximum.Y - Minimum.Y, 2) +
        Math.Pow(Maximum.Z - Minimum.Z, 2));
}

public sealed class RenderScene
{
    public IReadOnlyList<ScenePoint> Joints { get; init; } = [];
    public IReadOnlyList<SceneLineSegment> FrameSegments { get; init; } = [];
    public IReadOnlyList<SceneLineSegment> AreaEdges { get; init; } = [];
    public SceneBounds Bounds { get; init; } = new(new(0, 0, 0), new(1, 1, 1));
    public int SkippedFrames { get; init; }
    public int SkippedAreas { get; init; }
}
