codeunit 88811 "CG-AL-X058 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Buffer: Record "CG X058 Buffer";
    begin
        Buffer.DeleteAll();
    end;

    [Test]
    procedure CountsDistinctLabelsWithRepeats()
    var
        Deduper: Codeunit "CG X058 Deduper";
        Labels: List of [Text];
    begin
        Reset();
        Labels.Add('ALPHA');
        Labels.Add('BETA');
        Labels.Add('ALPHA');
        Labels.Add('GAMMA');
        Labels.Add('BETA');

        Assert.AreEqual(3, Deduper.DistinctCount(Labels), 'ALPHA, BETA and GAMMA are three distinct labels');
    end;

    [Test]
    procedure AllRepeatsCountAsOne()
    var
        Deduper: Codeunit "CG X058 Deduper";
        Labels: List of [Text];
    begin
        Reset();
        Labels.Add('SAME');
        Labels.Add('SAME');
        Labels.Add('SAME');

        Assert.AreEqual(1, Deduper.DistinctCount(Labels), 'Three copies of one label are one distinct label');
    end;

    [Test]
    procedure AllDistinctCountsEveryLabel()
    var
        Deduper: Codeunit "CG X058 Deduper";
        Labels: List of [Text];
    begin
        Reset();
        Labels.Add('A');
        Labels.Add('B');
        Labels.Add('C');

        Assert.AreEqual(3, Deduper.DistinctCount(Labels), 'Three different labels are three distinct labels');
    end;

    [Test]
    procedure TheBufferHoldsOneRowPerDistinctLabel()
    var
        Deduper: Codeunit "CG X058 Deduper";
        Buffer: Record "CG X058 Buffer";
        Labels: List of [Text];
    begin
        Reset();
        Labels.Add('X');
        Labels.Add('Y');
        Labels.Add('X');

        Deduper.DistinctCount(Labels);
        Assert.AreEqual(2, Buffer.Count(), 'The buffer must hold one row per distinct label');
    end;

    [Test]
    procedure AnEmptyListCountsZero()
    var
        Deduper: Codeunit "CG X058 Deduper";
        Labels: List of [Text];
    begin
        Reset();
        Assert.AreEqual(0, Deduper.DistinctCount(Labels), 'An empty list has no distinct labels');
    end;
}
