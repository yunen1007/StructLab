using StructLab.Core.Models;
using StructLab.Core.Services;

namespace StructLab.Core.Tests.Services;

public sealed class ScenePickingServiceTests
{
    private readonly ScenePickingService _service = new();

    [Fact]
    public void FindNearest_PointNearTwoSegments_ReturnsClosestSegment()
    {
        var segments = new[]
        {
            Segment("near", new(0, 0, 0), new(10, 0, 0)),
            Segment("far", new(0, 5, 0), new(10, 5, 0))
        };

        var selected = _service.FindNearest(segments, new ScenePoint(4, 0.2, 0), 1);

        Assert.NotNull(selected);
        Assert.Equal("near", selected.ObjectId);
    }

    [Fact]
    public void FindNearest_OutsideMaximumDistance_ReturnsNull()
    {
        var selected = _service.FindNearest(
            [Segment("F1", new(0, 0, 0), new(1, 0, 0))],
            new ScenePoint(0, 2, 0),
            0.5);

        Assert.Null(selected);
    }

    [Fact]
    public void FindNearest_ZeroLengthSegment_CanStillBeSelected()
    {
        var selected = _service.FindNearest(
            [Segment("F1", new(1, 1, 1), new(1, 1, 1))],
            new ScenePoint(1.1, 1, 1),
            0.2);

        Assert.NotNull(selected);
    }

    [Fact]
    public void FindNearest_NegativeTolerance_ThrowsClearException()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            _service.FindNearest([], new ScenePoint(), -0.1));
    }

    private static SceneLineSegment Segment(string id, ScenePoint start, ScenePoint end) =>
        new(StructuralObjectKind.Frame, id, start, end);
}
