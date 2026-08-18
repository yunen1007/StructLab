namespace StructLab.Core.Models;

public sealed class S2kTable
{
    public S2kTable(string name) => Name = name;

    public string Name { get; }
    public List<Dictionary<string, string>> Rows { get; } = [];
}
