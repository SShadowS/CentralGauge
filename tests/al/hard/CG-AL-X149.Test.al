codeunit 89369 "CG-AL-X149 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        Header: Record "CG X149 Allocation Header";
        Line: Record "CG X149 Allocation Line";
        Entry: Record "CG X149 Allocation Entry";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        Entry.DeleteAll();
    end;

    local procedure SeedHeader(DocumentNo: Code[20]; DepartmentCode: Code[10])
    var
        Header: Record "CG X149 Allocation Header";
    begin
        Header.Init();
        Header."Document No." := DocumentNo;
        Header."Department Code" := DepartmentCode;
        Header.Insert();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; DepartmentCode: Code[10]; Amount: Decimal)
    var
        Line: Record "CG X149 Allocation Line";
    begin
        Line.Init();
        Line."Document No." := DocumentNo;
        Line."Line No." := LineNo;
        Line."Department Code" := DepartmentCode;
        Line.Amount := Amount;
        Line.Insert();
    end;

    local procedure SeedEntry(DocumentNo: Code[20]; LineNo: Integer; DepartmentCode: Code[10]; Amount: Decimal)
    var
        Entry: Record "CG X149 Allocation Entry";
    begin
        Entry.Init();
        Entry."Document No." := DocumentNo;
        Entry."Line No." := LineNo;
        Entry."Department Code" := DepartmentCode;
        Entry.Amount := Amount;
        Entry.Insert(true);
    end;

    local procedure AssertEntry(DocumentNo: Code[20]; LineNo: Integer; ExpectedDepartmentCode: Code[10]; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        Entry: Record "CG X149 Allocation Entry";
    begin
        Entry.SetRange("Document No.", DocumentNo);
        Entry.SetRange("Line No.", LineNo);
        Assert.IsTrue(Entry.FindFirst(), MessagePrefix + ' - entry exists');
        Assert.AreEqual(ExpectedDepartmentCode, Entry."Department Code", MessagePrefix + ' - entry department code');
        Assert.AreEqual(ExpectedAmount, Entry.Amount, MessagePrefix + ' - entry amount');
    end;

    local procedure AssertEntryCount(DocumentNo: Code[20]; ExpectedCount: Integer; MessagePrefix: Text)
    var
        Entry: Record "CG X149 Allocation Entry";
    begin
        Entry.SetRange("Document No.", DocumentNo);
        Assert.AreEqual(ExpectedCount, Entry.Count(), MessagePrefix + ' - number of entries for the document');
    end;

    local procedure AssertNoEntries(DocumentNo: Code[20]; MessagePrefix: Text)
    begin
        AssertEntryCount(DocumentNo, 0, MessagePrefix);
    end;

    [Test]
    procedure DocumentWhoseLinesRoundToTheirRawTotalPostsWithNoExtraEntry()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedEntry('SENTINEL-DOC', 10, 'SENTDEPT', 999);
        SeedHeader('DOC1', 'IGNORED');
        SeedLine('DOC1', 10, 'SALES', 10);
        SeedLine('DOC1', 20, 'OPS', 5);

        Poster.PostAllocations('DOC1');

        AssertEntry('DOC1', 10, 'SALES', 10, 'A line whose amount is already a whole number posts unchanged');
        AssertEntry('DOC1', 20, 'OPS', 5, 'A second line on the same document posts independently');
        AssertEntryCount('DOC1', 2, 'A document whose lines sum exactly must not gain an extra entry');
        AssertEntry('SENTINEL-DOC', 10, 'SENTDEPT', 999, 'An unrelated document''s entry must not be touched by posting a different document');
    end;

    [Test]
    procedure DocumentWithAPositiveRemainderPostsTheExtraEntryUnderTheHeaderDepartment()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC2', 'HQ');
        SeedLine('DOC2', 10, 'SALES', 10.3);
        SeedLine('DOC2', 20, 'OPS', 10.4);

        Poster.PostAllocations('DOC2');

        AssertEntry('DOC2', 10, 'SALES', 10, 'The first line posts its own rounded amount');
        AssertEntry('DOC2', 20, 'OPS', 10, 'The second line posts its own rounded amount');
        AssertEntry('DOC2', 0, 'HQ', 1, 'The extra entry carries the document''s own department and the exact shortfall');
        AssertEntryCount('DOC2', 3, 'A document with a remainder posts exactly one extra entry beyond its lines');
    end;

    [Test]
    procedure DocumentWithANegativeRemainderPostsTheExtraEntryWithTheExactShortfall()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC3', 'FIN');
        SeedLine('DOC3', 10, 'OPS', 10.6);
        SeedLine('DOC3', 20, 'SALES', 10.6);

        Poster.PostAllocations('DOC3');

        AssertEntry('DOC3', 10, 'OPS', 11, 'The first line posts its own rounded amount');
        AssertEntry('DOC3', 20, 'SALES', 11, 'The second line posts its own rounded amount');
        AssertEntry('DOC3', 0, 'FIN', -1, 'A negative remainder posts as a negative extra entry under the document''s department');
        AssertEntryCount('DOC3', 3, 'A document with a negative remainder still posts exactly one extra entry');
    end;

    [Test]
    procedure ThreeLineDocumentRemainderReflectsEveryLineNotJustOne()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC4', 'OPS3');
        SeedLine('DOC4', 10, 'A', 5.3);
        SeedLine('DOC4', 20, 'B', 5.3);
        SeedLine('DOC4', 30, 'C', 5.3);

        Poster.PostAllocations('DOC4');

        AssertEntry('DOC4', 10, 'A', 5, 'The first of three lines posts its own rounded amount');
        AssertEntry('DOC4', 20, 'B', 5, 'The second of three lines posts its own rounded amount');
        AssertEntry('DOC4', 30, 'C', 5, 'The third of three lines posts its own rounded amount');
        AssertEntry('DOC4', 0, 'OPS3', 1, 'The extra entry reflects the combined shortfall across all three lines, not just one');
        AssertEntryCount('DOC4', 4, 'A three-line document with a remainder posts exactly one extra entry beyond its lines');
    end;

    [Test]
    procedure MissingDepartmentOnALineStopsPostingWithNoEntriesWritten()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC5', 'CHKDEPT');
        SeedLine('DOC5', 10, 'SALES', 4);
        SeedLine('DOC5', 20, '', 6);
        SeedLine('DOC5', 30, 'OPS', 8);

        asserterror Poster.PostAllocations('DOC5');

        Assert.IsTrue(StrPos(GetLastErrorText(), 'DOC5') > 0, 'The error names the document that failed to post');
        Assert.IsTrue(StrPos(GetLastErrorText(), '20') > 0, 'The error names the line that is actually missing a department code');
        AssertNoEntries('DOC5', 'A document that fails to post must leave no entries behind, including for lines that were valid');
    end;

    [Test]
    procedure PostingOneDocumentDoesNotAffectAnotherAndEachKeepsItsOwnDepartment()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC-A', 'XDEPT');
        SeedLine('DOC-A', 10, 'SALES', 10.3);
        SeedLine('DOC-A', 20, 'OPS', 10.4);
        SeedHeader('DOC-B', 'YDEPT');
        SeedLine('DOC-B', 10, 'OPS', 10.6);
        SeedLine('DOC-B', 20, 'SALES', 10.6);

        Poster.PostAllocations('DOC-A');

        AssertNoEntries('DOC-B', 'Posting one document must not post an untouched document''s lines');

        Poster.PostAllocations('DOC-B');

        AssertEntry('DOC-A', 0, 'XDEPT', 1, 'The first document''s extra entry keeps its own department after a second document posts');
        AssertEntry('DOC-B', 0, 'YDEPT', -1, 'The second document''s extra entry uses its own department, not the first document''s');
        AssertEntryCount('DOC-A', 3, 'The first document''s entries are unaffected by posting the second document');
        AssertEntryCount('DOC-B', 3, 'The second document posts its own full set of entries');
    end;

    [Test]
    procedure GetHeaderDepartmentReturnsTheStoredDepartmentOrBlankWhenUnknown()
    var
        Poster: Codeunit "CG X149 Allocation Poster";
    begin
        ClearAll();
        SeedHeader('DOC6', 'ADMIN');

        Assert.AreEqual('ADMIN', Poster.GetHeaderDepartment('DOC6'), 'A known document reports its stored department');
        Assert.AreEqual('', Poster.GetHeaderDepartment('DOC-UNKNOWN'), 'A document with no header record reports a blank department');
    end;
}
