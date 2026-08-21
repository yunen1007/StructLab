using StructLab.Core.Models;

namespace StructLab.Core.Services;

public sealed class RenderSceneBuilder
{
    public RenderScene Build(StructuralModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var joints = model.Joints.Values
            .Select(ToScenePoint)
            .ToArray();
        var frames = new List<SceneLineSegment>(model.Frames.Count);
        var areaEdges = new List<SceneLineSegment>();
        var skippedFrames = 0;
        var skippedAreas = 0;

        foreach (var frame in model.Frames)
        {
            if (!model.Joints.TryGetValue(frame.JointI, out var start) ||
                !model.Joints.TryGetValue(frame.JointJ, out var end))
            {
                skippedFrames++;
                continue;
            }

            frames.Add(new SceneLineSegment(
                StructuralObjectKind.Frame,
                frame.Id,
                ToScenePoint(start),
                ToScenePoint(end),
                frame.Section));
        }

        foreach (var area in model.Areas)
        {
            var polygon = area.JointIds
                .Select(id => model.Joints.TryGetValue(id, out var joint) ? joint : null)
                .ToArray();
            if (polygon.Length < 3 || polygon.Any(joint => joint is null))
            {
                skippedAreas++;
                continue;
            }

            for (var index = 0; index < polygon.Length; index++)
            {
                var start = polygon[index]!;
                var end = polygon[(index + 1) % polygon.Length]!;
                areaEdges.Add(new SceneLineSegment(
                    StructuralObjectKind.Area,
                    area.Id,
                    ToScenePoint(start),
                    ToScenePoint(end),
                    area.Section));
            }
        }

        return new RenderScene
        {
            Joints = joints,
            FrameSegments = frames,
            AreaEdges = areaEdges,
            Bounds = BuildBounds(joints),
            SkippedFrames = skippedFrames,
            SkippedAreas = skippedAreas
        };
    }

    private static SceneBounds BuildBounds(IReadOnlyList<ScenePoint> points)
    {
        if (points.Count == 0)
        {
            return new SceneBounds(new(0, 0, 0), new(1, 1, 1));
        }

        return new SceneBounds(
            new ScenePoint(points.Min(point => point.X), points.Min(point => point.Y), points.Min(point => point.Z)),
            new ScenePoint(points.Max(point => point.X), points.Max(point => point.Y), points.Max(point => point.Z)));
    }

    private static ScenePoint ToScenePoint(Joint joint) => new(joint.X, joint.Y, joint.Z);
}
