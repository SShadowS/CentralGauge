codeunit 80042 "CG-AL-M043 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestRenameCascadesThreeChildren()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        // [SCENARIO] Renaming a parent with 3 children moves all 3 to the new code.
        DeleteAllH2Data();

        InsertGroup('OLD-A', 'Old group');
        InsertLine('OLD-A', 'L1', 'Line 1', 10);
        InsertLine('OLD-A', 'L2', 'Line 2', 20);
        InsertLine('OLD-A', 'L3', 'Line 3', 30);

        Group.Get('OLD-A');
        Group.Rename('NEW-A');

        Line.Reset();
        Line.SetRange("Group Code", 'OLD-A');
        Assert.IsTrue(Line.IsEmpty(), 'No lines must remain under the old group code after rename');

        Line.Reset();
        Line.SetRange("Group Code", 'NEW-A');
        Assert.AreEqual(3, Line.Count(), 'All 3 child lines must be cascaded to the new group code');

        Assert.IsTrue(Line.Get('NEW-A', 'L1'), 'Line L1 must exist under new group code');
        Assert.IsTrue(Line.Get('NEW-A', 'L2'), 'Line L2 must exist under new group code');
        Assert.IsTrue(Line.Get('NEW-A', 'L3'), 'Line L3 must exist under new group code');
    end;

    [Test]
    procedure TestRenameDoesNotSkipUnderRepeatNext()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        // [SCENARIO] With 5 children, the rename must cascade to ALL of them.
        // An iteration that mutates the filter set (repeat ... until Next() = 0
        // over a SetRange filtered by the renamed key) typically renames only the
        // first child and leaves the rest under the old code.
        DeleteAllH2Data();

        InsertGroup('SRC', 'Source group');
        InsertLine('SRC', 'A', 'Line A', 1);
        InsertLine('SRC', 'B', 'Line B', 2);
        InsertLine('SRC', 'C', 'Line C', 3);
        InsertLine('SRC', 'D', 'Line D', 4);
        InsertLine('SRC', 'E', 'Line E', 5);

        Group.Get('SRC');
        Group.Rename('DST');

        Line.Reset();
        Line.SetRange("Group Code", 'SRC');
        Assert.AreEqual(0, Line.Count(), 'Zero children must remain under the previous group code');

        Line.Reset();
        Line.SetRange("Group Code", 'DST');
        Assert.AreEqual(5, Line.Count(), 'All 5 children must follow the rename');
    end;

    [Test]
    procedure TestRenameOnlyFiltersByPreviousCode()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        // [SCENARIO] At OnRename time the parent record already holds the new
        // primary key, while the previous key is only available via xRec.
        // Filtering children by the new key matches no rows, so no cascade
        // happens and the children remain orphaned under the old group code.
        DeleteAllH2Data();

        InsertGroup('FROM', 'Original');
        InsertLine('FROM', 'X1', 'First', 1);
        InsertLine('FROM', 'X2', 'Second', 2);

        Group.Get('FROM');
        Group.Rename('TO');

        Line.Reset();
        Line.SetRange("Group Code", 'FROM');
        Assert.IsTrue(Line.IsEmpty(), 'Filtering child lines by the OLD parent code must return zero rows after rename');

        Line.Reset();
        Line.SetRange("Group Code", 'TO');
        Assert.AreEqual(2, Line.Count(), 'Children must be reachable through the NEW parent code after rename');
    end;

    [Test]
    procedure TestRenameLeavesOtherParentsUntouched()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        // [SCENARIO] Renaming parent A must NOT touch children of parent B.
        DeleteAllH2Data();

        InsertGroup('GA', 'Group A');
        InsertLine('GA', 'L1', 'A-L1', 10);
        InsertLine('GA', 'L2', 'A-L2', 20);

        InsertGroup('GB', 'Group B');
        InsertLine('GB', 'L1', 'B-L1', 100);
        InsertLine('GB', 'L2', 'B-L2', 200);

        Group.Get('GA');
        Group.Rename('GA2');

        Line.Reset();
        Line.SetRange("Group Code", 'GA2');
        Assert.AreEqual(2, Line.Count(), 'Renamed parent must keep its 2 children');

        Line.Reset();
        Line.SetRange("Group Code", 'GB');
        Assert.AreEqual(2, Line.Count(), 'Untouched parent must still have its 2 children');

        Assert.IsTrue(Line.Get('GB', 'L1'), 'GB/L1 must remain reachable');
        Assert.IsTrue(Line.Get('GB', 'L2'), 'GB/L2 must remain reachable');
    end;

    [Test]
    procedure TestRenamePreservesChildFields()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        // [SCENARIO] Cascaded rename must preserve every child's Line Code,
        // Description and Sort Order. Only Group Code may change.
        DeleteAllH2Data();

        InsertGroup('P1', 'Parent 1');
        InsertLine('P1', 'ALPHA', 'Alpha desc', 7);
        InsertLine('P1', 'BETA', 'Beta desc', 42);

        Group.Get('P1');
        Group.Rename('P1X');

        Line.Get('P1X', 'ALPHA');
        Assert.AreEqual('Alpha desc', Line.Description, 'Description on ALPHA must be preserved through rename');
        Assert.AreEqual(7, Line."Sort Order", 'Sort Order on ALPHA must be preserved through rename');

        Line.Get('P1X', 'BETA');
        Assert.AreEqual('Beta desc', Line.Description, 'Description on BETA must be preserved through rename');
        Assert.AreEqual(42, Line."Sort Order", 'Sort Order on BETA must be preserved through rename');
    end;

    local procedure DeleteAllH2Data()
    var
        Group: Record "CG M043 Document Group";
        Line: Record "CG M043 Document Line";
    begin
        if not Line.IsEmpty() then
            Line.DeleteAll();
        if not Group.IsEmpty() then
            Group.DeleteAll();
    end;

    local procedure InsertGroup(Code: Code[20]; Description: Text[100])
    var
        Group: Record "CG M043 Document Group";
    begin
        Group.Init();
        Group.Code := Code;
        Group.Description := Description;
        Group.Insert(true);
    end;

    local procedure InsertLine(GroupCode: Code[20]; LineCode: Code[20]; Description: Text[100]; SortOrder: Integer)
    var
        Line: Record "CG M043 Document Line";
    begin
        Line.Init();
        Line."Group Code" := GroupCode;
        Line."Line Code" := LineCode;
        Line.Description := Description;
        Line."Sort Order" := SortOrder;
        Line.Insert(true);
    end;
}
