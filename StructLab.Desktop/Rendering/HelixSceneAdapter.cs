using System.Numerics;
using HelixToolkit.Geometry;
using StructLab.Core.Models;

namespace StructLab.Desktop.Rendering;

internal static class HelixSceneAdapter
{
    public static LineGeometry3D BuildLines(IEnumerable<SceneLineSegment> segments)
    {
        var positions = new Vector3Collection();
        var indices = new IntCollection();

        foreach (var segment in segments)
        {
            var startIndex = positions.Count;
            positions.Add(ToVector(segment.Start));
            positions.Add(ToVector(segment.End));
            indices.Add(startIndex);
            indices.Add(startIndex + 1);
        }

        return new LineGeometry3D
        {
            Positions = positions,
            Indices = indices
        };
    }

    public static PointGeometry3D BuildPoints(IEnumerable<ScenePoint> points)
    {
        var positions = new Vector3Collection();
        var indices = new IntCollection();
        foreach (var point in points)
        {
            indices.Add(positions.Count);
            positions.Add(ToVector(point));
        }

        return new PointGeometry3D
        {
            Positions = positions,
            Indices = indices
        };
    }

    private static Vector3 ToVector(ScenePoint point) => new(
        checked((float)point.X),
        checked((float)point.Y),
        checked((float)point.Z));
}
