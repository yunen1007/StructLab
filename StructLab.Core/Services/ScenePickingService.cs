using StructLab.Core.Models;

namespace StructLab.Core.Services;

public sealed class ScenePickingService
{
    public SceneLineSegment? FindNearest(
        IEnumerable<SceneLineSegment> segments,
        ScenePoint hitPoint,
        double maximumDistance)
    {
        ArgumentNullException.ThrowIfNull(segments);
        if (maximumDistance < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumDistance));
        }

        SceneLineSegment? nearest = null;
        var nearestSquared = maximumDistance * maximumDistance;
        foreach (var segment in segments)
        {
            var distanceSquared = DistanceSquared(hitPoint, segment.Start, segment.End);
            if (distanceSquared <= nearestSquared)
            {
                nearest = segment;
                nearestSquared = distanceSquared;
            }
        }

        return nearest;
    }

    internal static double DistanceSquared(ScenePoint point, ScenePoint start, ScenePoint end)
    {
        var dx = end.X - start.X;
        var dy = end.Y - start.Y;
        var dz = end.Z - start.Z;
        var lengthSquared = dx * dx + dy * dy + dz * dz;
        if (lengthSquared <= double.Epsilon)
        {
            return Squared(point.X - start.X, point.Y - start.Y, point.Z - start.Z);
        }

        var projection = ((point.X - start.X) * dx + (point.Y - start.Y) * dy + (point.Z - start.Z) * dz) / lengthSquared;
        projection = Math.Clamp(projection, 0, 1);
        return Squared(
            point.X - (start.X + projection * dx),
            point.Y - (start.Y + projection * dy),
            point.Z - (start.Z + projection * dz));
    }

    private static double Squared(double x, double y, double z) => x * x + y * y + z * z;
}
