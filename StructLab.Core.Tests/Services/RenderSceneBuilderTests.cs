using StructLab.Core.Models;
using StructLab.Core.Services;

namespace StructLab.Core.Tests.Services;

public sealed class RenderSceneBuilderTests
{
    private readonly RenderSceneBuilder _service = new();

    [Fact]
    public void Build_ValidFrameAndArea_CreatesExpectedGeometryAndBounds()
    {
        var model = new StructuralModel();
        AddJoint(model, "1", 0, 0, 0);
        AddJoint(model, "2", 4, 0, 0);
        AddJoint(model, "3", 4, 3, 2);
        model.Frames.Add(new Frame { Id = "F1", JointI = "1", JointJ = "2", Section = "H400" });
        var area = new Area { Id = "A1", Section = "S15" };
        area.JointIds.AddRange(["1", "2", "3"]);
        model.Areas.Add(area);

        var scene = _service.Build(model);

        Assert.Equal(3, scene.Joints.Count);
        Assert.Single(scene.FrameSegments);
        Assert.Equal(3, scene.AreaEdges.Count);
        Assert.Equal(new ScenePoint(0, 0, 0), scene.Bounds.Minimum);
        Assert.Equal(new ScenePoint(4, 3, 2), scene.Bounds.Maximum);
        Assert.Equal("H400", scene.FrameSegments[0].SectionName);
        Assert.Equal(0, scene.SkippedFrames);
        Assert.Equal(0, scene.SkippedAreas);
    }

    [Fact]
    public void Build_EmptyModel_UsesNonZeroDefaultBounds()
    {
        var scene = _service.Build(new StructuralModel());

        Assert.Empty(scene.Joints);
        Assert.Equal(new ScenePoint(0, 0, 0), scene.Bounds.Minimum);
        Assert.Equal(new ScenePoint(1, 1, 1), scene.Bounds.Maximum);
    }

    [Fact]
    public void Build_MissingJoint_SkipsInvalidObjectsWithoutThrowing()
    {
        var model = new StructuralModel();
        AddJoint(model, "1", 0, 0, 0);
        model.Frames.Add(new Frame { Id = "F1", JointI = "1", JointJ = "404" });
        var area = new Area { Id = "A1" };
        area.JointIds.AddRange(["1", "404", "405"]);
        model.Areas.Add(area);

        var scene = _service.Build(model);

        Assert.Empty(scene.FrameSegments);
        Assert.Empty(scene.AreaEdges);
        Assert.Equal(1, scene.SkippedFrames);
        Assert.Equal(1, scene.SkippedAreas);
    }

    private static void AddJoint(StructuralModel model, string id, double x, double y, double z)
    {
        model.Joints[id] = new Joint { Id = id, X = x, Y = y, Z = z };
    }
}
