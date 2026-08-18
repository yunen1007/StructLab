using System.Globalization;
using System.Text.RegularExpressions;
using StructLab.Core.Models;

namespace StructLab.Core.Parsing;

public sealed partial class S2kParser
{
    private static readonly Regex Assignment = AssignmentRegex();

    public Dictionary<string, S2kTable> ParseTables(string source)
    {
        ArgumentNullException.ThrowIfNull(source);
        var tables = new Dictionary<string, S2kTable>(StringComparer.OrdinalIgnoreCase);
        S2kTable? current = null;
        var continuation = string.Empty;

        foreach (var rawLine in source.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            var line = rawLine.TrimEnd();
            if (line.EndsWith('_'))
            {
                continuation += line[..^1];
                continue;
            }

            line = continuation + line;
            continuation = string.Empty;
            var trimmed = line.Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (trimmed.StartsWith("TABLE:", StringComparison.OrdinalIgnoreCase))
            {
                var firstQuote = trimmed.IndexOf('"');
                var lastQuote = trimmed.LastIndexOf('"');
                current = firstQuote >= 0 && lastQuote > firstQuote
                    ? GetOrCreate(tables, trimmed[(firstQuote + 1)..lastQuote])
                    : null;
                continue;
            }

            if (trimmed.StartsWith("END TABLE DATA", StringComparison.OrdinalIgnoreCase))
            {
                current = null;
                continue;
            }

            if (current is null)
            {
                continue;
            }

            var row = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (Match match in Assignment.Matches(trimmed))
            {
                row[match.Groups[1].Value] = match.Groups[2].Success
                    ? match.Groups[2].Value
                    : match.Groups[3].Value;
            }

            if (row.Count > 0)
            {
                current.Rows.Add(row);
            }
        }

        return tables;
    }

    public StructuralModel BuildModel(IReadOnlyDictionary<string, S2kTable> tables)
    {
        var model = new StructuralModel();
        var program = Rows(tables, "PROGRAM CONTROL").FirstOrDefault();
        if (program is not null)
        {
            model.Units = Get(program, "CurrUnits");
            model.Version = $"{Get(program, "ProgramName")} {Get(program, "Version")}".Trim();
        }

        foreach (var row in Rows(tables, "JOINT COORDINATES"))
        {
            var id = Get(row, "Joint");
            if (id.Length > 0)
            {
                model.Joints[id] = new Joint { Id = id, X = Number(row, "GlobalX", "XorR"), Y = Number(row, "GlobalY", "Y"), Z = Number(row, "GlobalZ", "Z") };
            }
        }

        foreach (var row in Rows(tables, "CONNECTIVITY - FRAME"))
        {
            var id = Get(row, "Frame");
            if (id.Length > 0)
            {
                model.Frames.Add(new Frame { Id = id, JointI = Get(row, "JointI"), JointJ = Get(row, "JointJ"), Length = Number(row, "Length") });
            }
        }

        foreach (var row in Rows(tables, "CONNECTIVITY - AREA"))
        {
            var id = Get(row, "Area");
            if (id.Length == 0) continue;
            var area = new Area { Id = id };
            for (var index = 1; index <= 9; index++)
            {
                var joint = Get(row, $"Joint{index}");
                if (joint.Length > 0) area.JointIds.Add(joint);
            }
            model.Areas.Add(area);
        }

        foreach (var row in Rows(tables, "FRAME SECTION PROPERTIES 01 - GENERAL"))
        {
            var name = Get(row, "SectionName");
            if (name.Length > 0)
            {
                model.FrameSections[name] = new FrameSection { Name = name, Material = Get(row, "Material"), Shape = Get(row, "Shape", "Rectangular"), T3 = Number(row, "t3", fallback: 0.3), T2 = Number(row, "t2", fallback: 0.3), Tf = Number(row, "tf"), Tw = Number(row, "tw"), Area = Number(row, "Area") };
            }
        }

        foreach (var row in Rows(tables, "AREA SECTION PROPERTIES"))
        {
            var name = Get(row, "Section");
            if (name.Length > 0)
            {
                model.AreaSections[name] = new AreaSection { Name = name, Material = Get(row, "Material"), Type = Get(row, "AreaType"), Thickness = Number(row, "Thickness", fallback: 0.1) };
            }
        }

        var frames = model.Frames.ToDictionary(frame => frame.Id, StringComparer.OrdinalIgnoreCase);
        var areas = model.Areas.ToDictionary(area => area.Id, StringComparer.OrdinalIgnoreCase);
        foreach (var row in Rows(tables, "FRAME SECTION ASSIGNMENTS"))
        {
            if (frames.TryGetValue(Get(row, "Frame"), out var frame))
            {
                frame.Section = Get(row, "AnalSect", Get(row, "DesignSect"));
                frame.DesignSection = Get(row, "DesignSect", frame.Section ?? string.Empty);
            }
        }
        foreach (var row in Rows(tables, "AREA SECTION ASSIGNMENTS"))
            if (areas.TryGetValue(Get(row, "Area"), out var area)) area.Section = Get(row, "Section");
        foreach (var row in Rows(tables, "FRAME LOCAL AXES ASSIGNMENTS 1 - TYPICAL"))
            if (frames.TryGetValue(Get(row, "Frame"), out var frame)) frame.Angle = Number(row, "Angle");
        foreach (var row in Rows(tables, "JOINT RESTRAINT ASSIGNMENTS"))
            model.Restraints[Get(row, "Joint")] = [IsYes(row, "U1"), IsYes(row, "U2"), IsYes(row, "U3"), IsYes(row, "R1"), IsYes(row, "R2"), IsYes(row, "R3")];
        foreach (var row in Rows(tables, "GROUPS 2 - ASSIGNMENTS").Where(row => Get(row, "ObjectType").Equals("Frame", StringComparison.OrdinalIgnoreCase)))
            if (frames.TryGetValue(Get(row, "ObjectLabel"), out var frame)) frame.Groups.Add(Get(row, "GroupName"));

        foreach (var row in Rows(tables, "FRAME LOADS - DISTRIBUTED"))
        {
            var id = Get(row, "Frame");
            if (id.Length > 0) model.FrameLoads.Add(new FrameLoad { FrameId = id, Pattern = Get(row, "LoadPat", Get(row, "LoadCase")), Direction = Get(row, "Dir", "Gravity"), ValueAtI = Number(row, "FOverLA"), ValueAtJ = Number(row, "FOverLB") });
        }
        AddAreaLoads(model, Rows(tables, "AREA LOADS - UNIFORM TO FRAME"));
        AddAreaLoads(model, Rows(tables, "AREA LOADS - UNIFORM"));
        foreach (var row in Rows(tables, "LOAD PATTERN DEFINITIONS"))
            model.LoadPatterns.Add(new LoadPattern(Get(row, "LoadPat"), Get(row, "DesignType"), Number(row, "SelfWtMult")));

        foreach (var row in Rows(tables, "GRID LINES"))
            model.GridLines.Add(new GridLine(Get(row, "AxisDir"), Get(row, "GridID"), Number(row, "XRYZCoord")));
        AddMaterials(model, Rows(tables, "MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES"), true);
        AddMaterials(model, Rows(tables, "MATERIAL PROPERTIES 03A - STEEL DATA"), false);
        AddMaterials(model, Rows(tables, "MATERIAL PROPERTIES 03 - DESIGN STEEL"), false);
        AddInferredLoadPatterns(model);
        PopulateMissingLengths(model);
        return model;
    }

    private static void AddAreaLoads(StructuralModel model, IEnumerable<Dictionary<string, string>> rows)
    {
        foreach (var row in rows)
        {
            var id = Get(row, "Area");
            if (id.Length > 0) model.AreaLoads.Add(new AreaLoad { AreaId = id, Pattern = Get(row, "LoadPat", Get(row, "LoadCase")), Direction = Get(row, "Dir", "Gravity"), Value = Number(row, "UnifLoad") });
        }
    }

    private static void AddMaterials(StructuralModel model, IEnumerable<Dictionary<string, string>> rows, bool basicProperties)
    {
        foreach (var row in rows)
        {
            var name = Get(row, "Material");
            if (name.Length == 0) continue;
            if (!model.Materials.TryGetValue(name, out var material)) model.Materials[name] = material = new Material { Name = name };
            if (basicProperties) material.UnitWeight = Number(row, "UnitWeight");
            else { material.Fy = Number(row, "Fy"); material.Fu = Number(row, "Fu"); }
        }
    }

    private static void AddInferredLoadPatterns(StructuralModel model)
    {
        if (model.LoadPatterns.Count > 0) return;
        foreach (var name in model.FrameLoads.Select(load => load.Pattern).Concat(model.AreaLoads.Select(load => load.Pattern)).Where(name => name.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var upper = name.ToUpperInvariant();
            var type = upper.Contains("DEAD") || Regex.IsMatch(upper, "^DL\\d*$") || upper == "D" ? "Dead"
                : upper.Contains("LIVE") || Regex.IsMatch(upper, "^LL\\d*$") || upper == "L" ? "Live"
                : upper.Contains("WIND") || Regex.IsMatch(upper, "^W[PN]?[XYZ]") ? "Wind"
                : upper.Contains("QUAKE") || upper.Contains("SEIS") || upper.StartsWith("EQ") ? "Quake" : string.Empty;
            model.LoadPatterns.Add(new LoadPattern(name, type, 0));
        }
    }

    private static void PopulateMissingLengths(StructuralModel model)
    {
        foreach (var frame in model.Frames.Where(frame => frame.Length <= 0 && model.Joints.ContainsKey(frame.JointI) && model.Joints.ContainsKey(frame.JointJ)))
        {
            var a = model.Joints[frame.JointI];
            var b = model.Joints[frame.JointJ];
            frame.Length = Math.Sqrt(Math.Pow(b.X - a.X, 2) + Math.Pow(b.Y - a.Y, 2) + Math.Pow(b.Z - a.Z, 2));
        }
    }

    private static IEnumerable<Dictionary<string, string>> Rows(IReadOnlyDictionary<string, S2kTable> tables, string name) => tables.TryGetValue(name, out var table) ? table.Rows : [];
    private static S2kTable GetOrCreate(Dictionary<string, S2kTable> tables, string name) => tables.TryGetValue(name, out var table) ? table : tables[name] = new S2kTable(name);
    private static string Get(IReadOnlyDictionary<string, string> row, string key, string fallback = "") => row.TryGetValue(key, out var value) ? value : fallback;
    private static bool IsYes(IReadOnlyDictionary<string, string> row, string key) => Get(row, key).Equals("Yes", StringComparison.OrdinalIgnoreCase);
    private static double Number(IReadOnlyDictionary<string, string> row, string key, string? alternative = null, double fallback = 0) => double.TryParse(Get(row, key, alternative is null ? string.Empty : Get(row, alternative)), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : fallback;

    [GeneratedRegex(@"([A-Za-z0-9_#$.\-]+)=(?:""([^""]*)""|(\S+))")]
    private static partial Regex AssignmentRegex();
}
