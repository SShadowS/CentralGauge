codeunit 89305 "CG-AL-X111 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the table before seeding its own data.

    local procedure ClearAllItems()
    var
        WorkItem: Record "CG X111 Work Item";
    begin
        WorkItem.DeleteAll();
    end;

    local procedure CreateItem(No: Code[20]; ParentNo: Code[20]; SortOrder: Integer; IsOpen: Boolean; CategoryCode: Code[20]; OwnerNo: Code[20]; Hours: Decimal)
    var
        WorkItem: Record "CG X111 Work Item";
    begin
        WorkItem.Init();
        WorkItem."No." := No;
        WorkItem."Parent No." := ParentNo;
        WorkItem."Sort Order" := SortOrder;
        if IsOpen then
            WorkItem.Status := WorkItem.Status::Open
        else
            WorkItem.Status := WorkItem.Status::Done;
        WorkItem."Category Code" := CategoryCode;
        WorkItem."Owner No." := OwnerNo;
        WorkItem."Estimated Hours" := Hours;
        WorkItem.Insert();
    end;

    [Test]
    procedure NestedSubItemsAreCountedAndSummedAtAnyDepth()
    var
        Report: Codeunit "CG X111 Work Item Report";
    begin
        ClearAllItems();

        CreateItem('ROOT1', '', 10, true, 'CATA', 'OWN1', 999);
        CreateItem('A1', 'ROOT1', 10, true, 'CATA', 'OWN1', 5);
        CreateItem('A1A', 'A1', 10, true, 'CATA', 'OWN1', 2);
        CreateItem('A1B', 'A1', 20, false, 'CATA', 'OWN1', 3);
        CreateItem('A2', 'ROOT1', 20, false, 'CATA', 'OWN1', 4);
        CreateItem('A2A', 'A2', 10, true, 'CATA', 'OWN1', 1);

        Assert.AreEqual(3, Report.CountOpenSubItems('ROOT1'),
            'Expected every open sub-item nested anywhere beneath the item to be counted, however deep, with done ones skipped');
        Assert.AreEqual(15, Report.TotalEstimatedHours('ROOT1'),
            'Expected the hours of every sub-item nested anywhere beneath the item to be added up regardless of its own status');

        Assert.AreEqual(1, Report.CountOpenSubItems('A1'),
            'Expected the open count for a sub-item to reflect only what is nested beneath it, not the whole checklist');
        Assert.AreEqual(5, Report.TotalEstimatedHours('A1'),
            'Expected the hours total for a sub-item to reflect only what is nested beneath it, not the whole checklist');
    end;

    [Test]
    procedure LeafItemHasNoSubItems()
    var
        Report: Codeunit "CG X111 Work Item Report";
        WorkItem: Record "CG X111 Work Item";
    begin
        ClearAllItems();

        CreateItem('SOLO', '', 10, true, 'CATB', 'OWN2', 42);

        Assert.AreEqual(0, Report.CountOpenSubItems('SOLO'),
            'Expected an item with no sub-items nested beneath it to report zero open sub-items');
        Assert.AreEqual(0, Report.TotalEstimatedHours('SOLO'),
            'Expected an item with no sub-items nested beneath it to report zero hours');

        WorkItem.Get('SOLO');
        Assert.AreEqual('CATB', WorkItem."Category Code",
            'Expected the item''s own category to survive untouched');
        Assert.AreEqual('OWN2', WorkItem."Owner No.",
            'Expected the item''s own owner to survive untouched');
        Assert.AreEqual(10, WorkItem."Sort Order",
            'Expected the item''s own sort order to survive untouched');
    end;

    [Test]
    procedure UnrelatedSubtreeIsNotCountedInAnotherItemsRollup()
    var
        Report: Codeunit "CG X111 Work Item Report";
    begin
        ClearAllItems();

        CreateItem('ROOTX', '', 10, true, 'CATX', 'OWNX', 0);
        CreateItem('X1', 'ROOTX', 10, true, 'CATX', 'OWNX', 7);

        CreateItem('ROOTY', '', 10, true, 'CATY', 'OWNY', 0);
        CreateItem('Y1', 'ROOTY', 10, true, 'CATY', 'OWNY', 500);
        CreateItem('Y2', 'ROOTY', 20, true, 'CATY', 'OWNY', 500);

        Assert.AreEqual(1, Report.CountOpenSubItems('ROOTX'),
            'Expected only ROOTX''s own sub-item to be counted, not an unrelated checklist''s items');
        Assert.AreEqual(7, Report.TotalEstimatedHours('ROOTX'),
            'Expected only ROOTX''s own sub-item''s hours to be totaled, not an unrelated checklist''s hours');
    end;

    [Test]
    procedure AnItemDoesNotIncludeItselfInItsOwnRollup()
    var
        Report: Codeunit "CG X111 Work Item Report";
    begin
        ClearAllItems();

        CreateItem('PARENT', '', 10, true, 'CATZ', 'OWNZ', 9999);
        CreateItem('CHILD1', 'PARENT', 10, false, 'CATZ', 'OWNZ', 6);

        Assert.AreEqual(0, Report.CountOpenSubItems('PARENT'),
            'Expected the item''s own open status to be excluded from its own sub-item count - its only sub-item is done');
        Assert.AreEqual(6, Report.TotalEstimatedHours('PARENT'),
            'Expected the item''s own hours to be excluded from its own sub-item total - only its sub-item''s hours belong in it');
    end;

    [Test]
    procedure RepeatedCallsReflectItemsAddedSinceThePreviousCall()
    var
        Report: Codeunit "CG X111 Work Item Report";
    begin
        ClearAllItems();

        CreateItem('ROOTR', '', 10, true, 'CATR', 'OWNR', 0);
        CreateItem('R1', 'ROOTR', 10, true, 'CATR', 'OWNR', 8);

        Assert.AreEqual(1, Report.CountOpenSubItems('ROOTR'),
            'Expected the first call to reflect the one open sub-item recorded so far');
        Assert.AreEqual(8, Report.TotalEstimatedHours('ROOTR'),
            'Expected the first call to reflect the one sub-item''s hours recorded so far');

        CreateItem('R2', 'ROOTR', 20, true, 'CATR', 'OWNR', 5);

        Assert.AreEqual(2, Report.CountOpenSubItems('ROOTR'),
            'Expected a second call on the same item to reflect the sub-item added since the first call');
        Assert.AreEqual(13, Report.TotalEstimatedHours('ROOTR'),
            'Expected a second call on the same item to reflect the hours of the sub-item added since the first call');
    end;

    [Test]
    procedure OpenSubItemHoursAcrossChecklistCountsOpenSubItemsAtAnyDepthButNotRoots()
    var
        Report: Codeunit "CG X111 Work Item Report";
    begin
        ClearAllItems();

        CreateItem('ROOTQ', '', 10, true, 'CATQ', 'OWNQ', 1000);
        CreateItem('Q1', 'ROOTQ', 10, true, 'CATQ', 'OWNQ', 6);
        CreateItem('Q2', 'ROOTQ', 20, false, 'CATQ', 'OWNQ', 9);
        CreateItem('Q1A', 'Q1', 10, true, 'CATQ', 'OWNQ', 4);
        CreateItem('Q1B', 'Q1', 20, false, 'CATQ', 'OWNQ', 5);

        Assert.AreEqual(10, Report.OpenSubItemHoursAcrossChecklist(),
            'Expected the checklist-wide total to add up every open sub-item at any depth (Q1 and its own open sub-item Q1A), while excluding a root''s own hours and any done sub-item');
    end;

    [Test]
    procedure OpenDirectSubHoursFlowFieldSumsOnlyItsOwnOpenDirectChildren()
    var
        WorkItem: Record "CG X111 Work Item";
    begin
        ClearAllItems();

        CreateItem('FFPARENT', '', 10, true, 'CATF', 'OWNF', 0);
        CreateItem('FFC1', 'FFPARENT', 10, true, 'CATF', 'OWNF', 3);
        CreateItem('FFC2', 'FFPARENT', 20, true, 'CATF', 'OWNF', 4);
        CreateItem('FFC3', 'FFPARENT', 30, false, 'CATF', 'OWNF', 100);

        WorkItem.Get('FFPARENT');
        WorkItem.CalcFields("Open Direct Sub Hours");

        Assert.AreEqual(7, WorkItem."Open Direct Sub Hours",
            'Expected the field to sum only its own direct children that are open (FFC1 + FFC2), skipping the done one');
    end;

    [Test]
    procedure OpenSubItemHoursAcrossChecklistCostDoesNotGrowWithChecklistSize()
    var
        Report: Codeunit "CG X111 Work Item Report";
        HoursTotal: Decimal;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        ParentNo: Code[20];
        ChildNo: Code[20];
        ParentIndex: Integer;
    begin
        ClearAllItems();

        // Warm-up on a small, disjoint checklist so first-touch metadata/plan
        // loading lands outside the measurement window below.
        CreateItem('WARMROOT', '', 10, true, 'CATW', 'OWNW', 1);
        CreateItem('WARMCHILD', 'WARMROOT', 10, true, 'CATW', 'OWNW', 1);
        Report.OpenSubItemHoursAcrossChecklist();
        ClearAllItems();

        // 99 root parents, each with exactly one open child of its own -
        // most of the checklist really is parents with sub-items, not a
        // single real one buried among childless filler - plus BIGROOT
        // with two direct sub-items of its own. 201 items overall.
        for ParentIndex := 1 to 99 do begin
            ParentNo := CopyStr(StrSubstNo('P%1', ParentIndex), 1, MaxStrLen(ParentNo));
            ChildNo := CopyStr(StrSubstNo('C%1', ParentIndex), 1, MaxStrLen(ChildNo));
            CreateItem(ParentNo, '', ParentIndex, true, 'CATF', 'OWNF', 0);
            CreateItem(ChildNo, ParentNo, ParentIndex, true, 'CATF', 'OWNF', 3);
        end;

        CreateItem('BIGROOT', '', 10, true, 'CATP', 'OWNP', 0);
        CreateItem('BC1', 'BIGROOT', 10, true, 'CATP', 'OWNP', 10);
        CreateItem('BC2', 'BIGROOT', 20, false, 'CATP', 'OWNP', 20);

        // Forces the next reads to bypass the session's record cache, so a
        // rewrite that fakes a low cost by legitimately reading rows it
        // already touched this session still pays for them here.
        SelectLatestVersion();

        StmtBefore := SessionInformation.SqlStatementsExecuted;

        HoursTotal := Report.OpenSubItemHoursAcrossChecklist();

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        Assert.AreEqual(307, HoursTotal,
            'Expected the low-cost figure to still carry the real total - 99 open children at 3 hours each plus BC1''s 10 hours, with every root (including BIGROOT) and the done BC2 excluded');
        Assert.IsTrue(StmtDelta <= 5,
            StrSubstNo('The figure''s cost must not grow with the size of the checklist: statement budget %1, actual %2', 5, StmtDelta));
    end;
}
