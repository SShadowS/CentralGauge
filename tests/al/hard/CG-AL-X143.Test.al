codeunit 89363 "CG-AL-X143 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears every persisted table across every tile before seeding its own
    // rows. The dashboard's history feed, display list, and indicator
    // buffers are all temporary records owned by the caller, so they never
    // need clearing - each test declares its own.

    local procedure ClearAll()
    var
        Payment: Record "CG X134 Payment";
        Request: Record "CG X134 Request";
        HistoryEntry: Record "CG X134 History Entry";
        Assignment: Record "CG X133 Assignment";
        Person: Record "CG X133 Person";
        Team: Record "CG X133 Team";
        DispatchEntry: Record "CG X113 Dispatch Entry";
        ActivityEntry: Record "CG X109 Activity Entry";
    begin
        Payment.DeleteAll();
        Request.DeleteAll();
        HistoryEntry.DeleteAll();
        Assignment.DeleteAll();
        Person.DeleteAll();
        Team.DeleteAll();
        DispatchEntry.DeleteAll();
        ActivityEntry.DeleteAll();
    end;

    // ---------------------------------------------------------------
    // Approval-history feed helpers (live symptom source: CG X134)
    // ---------------------------------------------------------------

    local procedure SeedApproval(Approver: Code[50]; RequestNo: Code[20]; RequestDescription: Text[100]; PaidAmount: Decimal)
    var
        Request: Record "CG X134 Request";
        Payment: Record "CG X134 Payment";
        HistoryEntry: Record "CG X134 History Entry";
    begin
        Request.Init();
        Request."No." := RequestNo;
        Request.Description := RequestDescription;
        Request.Insert();

        Payment.Init();
        Payment."Request No." := RequestNo;
        Payment.Amount := PaidAmount;
        Payment.Insert(true);

        HistoryEntry.Init();
        HistoryEntry.Approver := Approver;
        HistoryEntry."Request No." := RequestNo;
        HistoryEntry.Insert();
    end;

    local procedure AssertShown(var Buffer: Record "CG X134 History Buffer" temporary; RequestNo: Code[20]; ExpectedDescription: Text[100]; ExpectedPaidAmount: Decimal)
    begin
        Buffer.SetRange("Request No.", RequestNo);
        Assert.IsTrue(Buffer.FindFirst(),
            StrSubstNo('Expected request %1 to appear in the feed', RequestNo));
        Assert.AreEqual(ExpectedDescription, Buffer.Description,
            StrSubstNo('Expected request %1''s description to be carried into the feed', RequestNo));
        Assert.AreEqual(ExpectedPaidAmount, Buffer."Paid Amount",
            StrSubstNo('Expected request %1''s paid amount to be carried into the feed', RequestNo));
        Buffer.Reset();
    end;

    local procedure AssertNotShown(var Buffer: Record "CG X134 History Buffer" temporary; RequestNo: Code[20])
    begin
        Buffer.SetRange("Request No.", RequestNo);
        Assert.IsFalse(Buffer.FindFirst(),
            StrSubstNo('Expected request %1 to be left out of the feed', RequestNo));
        Buffer.Reset();
    end;

    // ---------------------------------------------------------------
    // Team assignment display list helpers (distractor, correct both
    // sides: CG X133)
    // ---------------------------------------------------------------

    local procedure SeedPerson(PersonCode: Code[20]; DisplayName: Text[100])
    var
        Person: Record "CG X133 Person";
    begin
        Person.Init();
        Person."Code" := PersonCode;
        Person."Display Name" := DisplayName;
        Person.Insert();
    end;

    local procedure SeedTeam(TeamCode: Code[20]; DisplayName: Text[100])
    var
        Team: Record "CG X133 Team";
    begin
        Team.Init();
        Team."Code" := TeamCode;
        Team."Display Name" := DisplayName;
        Team.Insert();
    end;

    local procedure SeedAssignment(AssignmentNo: Code[20]; TeamCode: Code[20]; OwnerCode: Code[20]; AssignmentPriority: Integer)
    var
        Assignment: Record "CG X133 Assignment";
    begin
        Assignment.Init();
        Assignment."No." := AssignmentNo;
        Assignment."Team Code" := TeamCode;
        Assignment."Owner Code" := OwnerCode;
        Assignment.Priority := AssignmentPriority;
        Assignment.Insert();
    end;

    local procedure FlushDataCache()
    begin
        // The warm-up call and the fixture-seeding loop leave the session's
        // data cache warm, and a cache-served read costs zero in the
        // counters below - the graded call would then measure nothing. A
        // write to an unrelated row, followed by SelectLatestVersion, forces
        // real statements again for the measured call.
        SeedAssignment('A-DECOY', 'TEAM-DECOY', 'P-DECOY', 1);
        SelectLatestVersion();
    end;

    local procedure X133MaxStatements(): Integer
    begin
        exit(20);
    end;

    // ---------------------------------------------------------------
    // Workload indicator helpers (distractor, correct both sides: CG
    // X113)
    // ---------------------------------------------------------------

    local procedure ClearAllEntries()
    begin
        ClearAll();
    end;

    local procedure SeedEntry(DispatcherCode: Code[20]; IsPending: Boolean)
    var
        DispatchEntry: Record "CG X113 Dispatch Entry";
    begin
        DispatchEntry.Init();
        DispatchEntry."Dispatcher Code" := DispatcherCode;
        DispatchEntry.Pending := IsPending;
        DispatchEntry.Insert(true);
    end;

    local procedure InvalidateDataCache()
    var
        DecoyEntry: Record "CG X113 Dispatch Entry";
    begin
        // The warm-up call leaves the table's result sets in the server data
        // cache, and a cached read costs zero SQL - the graded call would
        // measure nothing. A write bumps the table's version and forces real
        // statements again; the decoy entry belongs to a dispatcher no
        // graded call asks about.
        DecoyEntry.Init();
        DecoyEntry."Dispatcher Code" := 'D-DECOY';
        DecoyEntry.Pending := false;
        DecoyEntry.Insert(true);
        SelectLatestVersion();
    end;

    local procedure X113MaxStatements(): Integer
    begin
        exit(5);
    end;

    local procedure X113MaxRows(): Integer
    begin
        exit(10);
    end;

    // ---------------------------------------------------------------
    // Latest-activity indicator helpers (distractor, correct both
    // sides: CG X109)
    // ---------------------------------------------------------------

    local procedure MockEntry(DocumentNo: Code[20]; EntryAmount: Decimal): Integer
    var
        ActivityEntry: Record "CG X109 Activity Entry";
    begin
        if ActivityEntry.FindLast() then;
        ActivityEntry.Init();
        ActivityEntry."Entry No." += 1;
        ActivityEntry."Document No." := DocumentNo;
        ActivityEntry.Amount := EntryAmount;
        ActivityEntry.Insert();
        exit(ActivityEntry."Entry No.");
    end;

    local procedure DisturbCache()
    begin
        // The warm-up call below leaves the table's result set sitting in the
        // server data cache, and a cached read costs zero SQL - the graded
        // call would then measure nothing. A write bumps the table's version
        // and forces real statements again; the decoy entry sits under its
        // own document number, so no graded lookup can ever see it.
        MockEntry('CG-X109-DECOY', 1);
        SelectLatestVersion();
    end;

    // =================================================================
    // Approval-history feed tests (live symptom: CG X134)
    // =================================================================

    [Test]
    procedure ShortHistoryLoadsEveryEntryWithCorrectDetails()
    var
        Buffer: Record "CG X134 History Buffer" temporary;
        Loader: Codeunit "CG X134 History Loader";
    begin
        // [SCENARIO] An approver who has only just started has a short feed
        ClearAll();
        SeedApproval('APPR-NEW', 'REQ-N1', 'Alpha Request', 510);
        SeedApproval('APPR-NEW', 'REQ-N2', 'Bravo Request', 520);
        SeedApproval('APPR-NEW', 'REQ-N3', 'Charlie Request', 530);

        Loader.LoadRecentHistory('APPR-NEW', Buffer);

        Assert.AreEqual(3, Buffer.Count(),
            'Expected every one of the three entries to appear in a short feed');
        AssertShown(Buffer, 'REQ-N1', 'Alpha Request', 510);
        AssertShown(Buffer, 'REQ-N2', 'Bravo Request', 520);
        AssertShown(Buffer, 'REQ-N3', 'Charlie Request', 530);
    end;

    [Test]
    procedure LongHistoryShowsOnlyTheMostRecentEntries()
    var
        Buffer: Record "CG X134 History Buffer" temporary;
        Loader: Codeunit "CG X134 History Loader";
        RequestNo: Code[20];
        RequestDescription: Text[100];
        i: Integer;
    begin
        // [SCENARIO] A long-tenured approver's feed only shows the most
        // recent entries, not the whole history
        ClearAll();
        for i := 1 to 25 do begin
            RequestNo := CopyStr(StrSubstNo('REQ-B%1', i), 1, MaxStrLen(RequestNo));
            RequestDescription := CopyStr(StrSubstNo('Batch Request %1', i), 1, MaxStrLen(RequestDescription));
            SeedApproval('APPR-BATCH', RequestNo, RequestDescription, 2000 + i);
        end;

        Loader.LoadRecentHistory('APPR-BATCH', Buffer);

        Assert.AreEqual(20, Buffer.Count(),
            'Expected the feed to stop at the most recent entries instead of growing with the whole history');
        AssertShown(Buffer, 'REQ-B25', 'Batch Request 25', 2025);
        AssertShown(Buffer, 'REQ-B6', 'Batch Request 6', 2006);
        AssertNotShown(Buffer, 'REQ-B5');
        AssertNotShown(Buffer, 'REQ-B1');
    end;

    [Test]
    procedure HistoryOfOneApproverNeverLeaksIntoAnothers()
    var
        BufferA: Record "CG X134 History Buffer" temporary;
        BufferB: Record "CG X134 History Buffer" temporary;
        RequestB1: Record "CG X134 Request";
        Loader: Codeunit "CG X134 History Loader";
    begin
        // [SCENARIO] Two approvers' feeds are built independently, and the
        // second approver's own data survives building the first's feed
        ClearAll();
        SeedApproval('APPR-ISO-A', 'REQ-IA1', 'Iso Request A1', 701);
        SeedApproval('APPR-ISO-A', 'REQ-IA2', 'Iso Request A2', 702);
        SeedApproval('APPR-ISO-A', 'REQ-IA3', 'Iso Request A3', 703);
        // Approver B's entries are recorded AFTER A's, so a feed that
        // ignores which approver it is building for would surface these
        // instead of (or alongside) A's own entries.
        SeedApproval('APPR-ISO-B', 'REQ-IB1', 'Iso Request B1', 801);
        SeedApproval('APPR-ISO-B', 'REQ-IB2', 'Iso Request B2', 802);

        Loader.LoadRecentHistory('APPR-ISO-A', BufferA);

        Assert.AreEqual(3, BufferA.Count(),
            'Expected only approver A''s own three entries in A''s feed');
        AssertShown(BufferA, 'REQ-IA1', 'Iso Request A1', 701);
        AssertShown(BufferA, 'REQ-IA2', 'Iso Request A2', 702);
        AssertShown(BufferA, 'REQ-IA3', 'Iso Request A3', 703);
        AssertNotShown(BufferA, 'REQ-IB1');
        AssertNotShown(BufferA, 'REQ-IB2');

        Loader.LoadRecentHistory('APPR-ISO-B', BufferB);

        Assert.AreEqual(2, BufferB.Count(),
            'Expected only approver B''s own two entries in B''s feed');
        AssertShown(BufferB, 'REQ-IB1', 'Iso Request B1', 801);
        AssertShown(BufferB, 'REQ-IB2', 'Iso Request B2', 802);

        RequestB1.Get('REQ-IB1');
        RequestB1.CalcFields("Paid Amount");
        Assert.AreEqual(801, RequestB1."Paid Amount",
            'Expected building approver A''s feed to leave approver B''s own request data untouched');
    end;

    [Test]
    procedure EmptyHistoryProducesAnEmptyFeed()
    var
        Buffer: Record "CG X134 History Buffer" temporary;
        Loader: Codeunit "CG X134 History Loader";
    begin
        // [SCENARIO] An approver with no recorded history gets an empty feed
        ClearAll();
        SeedApproval('APPR-OTHER', 'REQ-O1', 'Other Request', 111);

        Loader.LoadRecentHistory('APPR-NOBODY', Buffer);

        Assert.IsTrue(Buffer.IsEmpty(),
            'Expected an approver with no history at all to get an empty feed');
    end;

    [Test]
    procedure RepeatedCallsPickUpNewlyRecordedApprovals()
    var
        FirstBuffer: Record "CG X134 History Buffer" temporary;
        SecondBuffer: Record "CG X134 History Buffer" temporary;
        Loader: Codeunit "CG X134 History Loader";
    begin
        // [SCENARIO] Building the feed again after a new approval was
        // recorded reflects it, not a stale snapshot
        ClearAll();
        SeedApproval('APPR-LIVE', 'REQ-L1', 'Live Request 1', 901);
        SeedApproval('APPR-LIVE', 'REQ-L2', 'Live Request 2', 902);
        SeedApproval('APPR-LIVE', 'REQ-L3', 'Live Request 3', 903);

        Loader.LoadRecentHistory('APPR-LIVE', FirstBuffer);
        Assert.AreEqual(3, FirstBuffer.Count(),
            'Expected the first feed to show the three entries recorded so far');
        AssertShown(FirstBuffer, 'REQ-L3', 'Live Request 3', 903);

        SeedApproval('APPR-LIVE', 'REQ-L4', 'Live Request 4', 904);

        Loader.LoadRecentHistory('APPR-LIVE', SecondBuffer);
        Assert.AreEqual(4, SecondBuffer.Count(),
            'Expected a second feed built after a new approval to include it, not repeat the first feed');
        AssertShown(SecondBuffer, 'REQ-L4', 'Live Request 4', 904);
        AssertShown(SecondBuffer, 'REQ-L1', 'Live Request 1', 901);
    end;

    [Test]
    procedure LoadingALongHistoryCostsNoMoreThanLoadingAShortOne()
    var
        Payment: Record "CG X134 Payment";
        Request: Record "CG X134 Request";
        HistoryEntry: Record "CG X134 History Entry";
        Buffer: Record "CG X134 History Buffer" temporary;
        Loader: Codeunit "CG X134 History Loader";
        Any: Codeunit Any;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        FlushCount: Integer;
        NSeed: Integer;
        RequestNo: Code[20];
        RequestDescription: Text[100];
        i: Integer;
    begin
        // [SCENARIO] Opening the feed of a long-tenured approver costs no
        // more than opening a short one
        ClearAll();

        // Warm-up on a DIFFERENT approver, cleared before the graded data is
        // seeded, so nothing the measured call needs was resolved beforehand.
        SeedApproval('APPR-WARM', 'REQ-W1', 'Warmup Request', 1);
        Loader.LoadRecentHistory('APPR-WARM', Buffer);
        ClearAll();

        Any.SetSeed(134);
        NSeed := Any.IntegerInRange(380, 420);
        for i := 1 to NSeed do begin
            RequestNo := CopyStr(StrSubstNo('REQ-P%1', i), 1, MaxStrLen(RequestNo));
            RequestDescription := CopyStr(StrSubstNo('Perf Request %1', i), 1, MaxStrLen(RequestDescription));
            SeedApproval('APPR-BUSY', RequestNo, RequestDescription, 5000 + i);
        end;

        // Force the buffered inserts to flush BEFORE the measured window.
        // Left to itself the flush lands inside it, at the first read of
        // whichever table is touched first, and its cost would scale with
        // how much history was seeded - exactly the dependence this budget
        // exists to exclude.
        FlushCount := Payment.Count() + Request.Count() + HistoryEntry.Count();

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        Loader.LoadRecentHistory('APPR-BUSY', Buffer);
        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        // Correctness inside the measured window, so a cheap-but-wrong
        // rewrite cannot pass on cost alone. Boundary literals pinned on
        // both sides of the cutoff.
        Assert.AreEqual(20, Buffer.Count(),
            'Expected the feed to stay at the most recent entries even for a long-tenured approver, not grow with the whole history');
        AssertShown(Buffer, CopyStr(StrSubstNo('REQ-P%1', NSeed), 1, MaxStrLen(RequestNo)),
            CopyStr(StrSubstNo('Perf Request %1', NSeed), 1, MaxStrLen(RequestDescription)), 5000 + NSeed);
        AssertShown(Buffer, CopyStr(StrSubstNo('REQ-P%1', NSeed - 19), 1, MaxStrLen(RequestNo)),
            CopyStr(StrSubstNo('Perf Request %1', NSeed - 19), 1, MaxStrLen(RequestDescription)), 5000 + NSeed - 19);
        AssertNotShown(Buffer, CopyStr(StrSubstNo('REQ-P%1', NSeed - 20), 1, MaxStrLen(RequestNo)));
        AssertNotShown(Buffer, 'REQ-P1');

        Assert.IsTrue(StmtDelta <= 60,
            StrSubstNo('Opening the feed must not get slower as an approver''s history grows: allowed %1, actual %2 for %3 history entries', 60, StmtDelta, NSeed));
    end;

    // =================================================================
    // Team assignment display list tests (distractor, correct both
    // sides: CG X133)
    // =================================================================

    [Test]
    procedure BuildRowsResolvesOwnerAndTeamDisplayNamesForEachAssignment()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-1', 'Squad One');
        SeedPerson('P-1', 'Alice Andersen');
        SeedAssignment('A-1', 'TEAM-1', 'P-1', 7);

        DisplayRowBuilder.BuildRows('TEAM-1', DisplayRow);

        DisplayRow.Get('A-1');
        Assert.AreEqual('Alice Andersen', DisplayRow."Owner Display",
            'Expected the assignment row to show the owner''s display name');
        Assert.AreEqual('Squad One', DisplayRow."Team Display",
            'Expected the assignment row to show the team''s display name');
        Assert.AreEqual(7, DisplayRow.Priority,
            'Expected the assignment''s priority to carry through to the row unchanged');
    end;

    [Test]
    procedure BuildRowsGivesEachAssignmentItsOwnOwnersName()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-2', 'Squad Two');
        SeedPerson('P-2A', 'Bo Berg');
        SeedPerson('P-2B', 'Carla Christensen');
        SeedAssignment('A-2A', 'TEAM-2', 'P-2A', 1);
        SeedAssignment('A-2B', 'TEAM-2', 'P-2B', 1);

        DisplayRowBuilder.BuildRows('TEAM-2', DisplayRow);

        DisplayRow.Get('A-2A');
        Assert.AreEqual('Bo Berg', DisplayRow."Owner Display",
            'Expected this assignment to show its own owner''s name, not a name belonging to another assignment in the same team');
        DisplayRow.Get('A-2B');
        Assert.AreEqual('Carla Christensen', DisplayRow."Owner Display",
            'Expected this assignment to show its own owner''s name, not a name belonging to another assignment in the same team');
    end;

    [Test]
    procedure BuildingTwoTeamsListsKeepsEachInItsOwnBuffer()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRowA: Record "CG X133 Display Row" temporary;
        DisplayRowB: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-3A', 'Squad Three-A');
        SeedTeam('TEAM-3B', 'Squad Three-B');
        SeedPerson('P-3A', 'Dan Dam');
        SeedPerson('P-3B', 'Eva Elm');
        SeedAssignment('A-3A', 'TEAM-3A', 'P-3A', 2);
        SeedAssignment('A-3B', 'TEAM-3B', 'P-3B', 3);

        DisplayRowBuilder.BuildRows('TEAM-3A', DisplayRowA);
        DisplayRowBuilder.BuildRows('TEAM-3B', DisplayRowB);

        Assert.AreEqual(1, DisplayRowA.Count(),
            'Expected team 3A''s own list to contain only its own assignment');
        DisplayRowA.Get('A-3A');
        Assert.AreEqual('Dan Dam', DisplayRowA."Owner Display",
            'Expected team 3A''s list to show its own owner name');
        Assert.IsFalse(DisplayRowA.Get('A-3B'),
            'Expected team 3A''s list to hold only team 3A''s assignments, not team 3B''s');

        Assert.AreEqual(1, DisplayRowB.Count(),
            'Expected team 3B''s own list to contain only its own assignment');
        DisplayRowB.Get('A-3B');
        Assert.AreEqual('Eva Elm', DisplayRowB."Owner Display",
            'Expected team 3B''s list to show its own owner name');
        Assert.IsFalse(DisplayRowB.Get('A-3A'),
            'Expected team 3B''s list to hold only team 3B''s assignments, not team 3A''s');
    end;

    [Test]
    procedure BuildingASecondTeamsListIntoTheSameBufferKeepsTheFirstTeamsRows()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-7A', 'Squad Seven-A');
        SeedTeam('TEAM-7B', 'Squad Seven-B');
        SeedPerson('P-7A', 'Hans Holm');
        SeedPerson('P-7B', 'Ida Iversen');
        SeedAssignment('A-7A', 'TEAM-7A', 'P-7A', 1);
        SeedAssignment('A-7B', 'TEAM-7B', 'P-7B', 2);

        DisplayRowBuilder.BuildRows('TEAM-7A', DisplayRow);
        DisplayRowBuilder.BuildRows('TEAM-7B', DisplayRow);

        DisplayRow.Reset();
        Assert.AreEqual(2, DisplayRow.Count(),
            'Expected the shared list to hold one row per assignment across both teams after building each team once');
        DisplayRow.Get('A-7A');
        Assert.AreEqual('Hans Holm', DisplayRow."Owner Display",
            'Expected the first team''s row to survive unchanged after building a second team''s list into the same buffer');
    end;

    [Test]
    procedure RebuildingATeamsListReflectsAnAssignmentAddedSinceTheLastBuild()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-4', 'Squad Four');
        SeedPerson('P-4A', 'Finn Fog');
        SeedPerson('P-4B', 'Gry Green');
        SeedAssignment('A-4A', 'TEAM-4', 'P-4A', 1);

        DisplayRowBuilder.BuildRows('TEAM-4', DisplayRow);
        Assert.AreEqual(1, DisplayRow.Count(),
            'Expected exactly one row after the first build with one assignment');

        SeedAssignment('A-4B', 'TEAM-4', 'P-4B', 1);
        DisplayRowBuilder.BuildRows('TEAM-4', DisplayRow);

        Assert.AreEqual(2, DisplayRow.Count(),
            'Expected the rebuilt list to include the assignment added since the last build');
        DisplayRow.Get('A-4A');
        Assert.AreEqual('Finn Fog', DisplayRow."Owner Display",
            'Expected the earlier assignment''s row to still be correct after a rebuild, not dropped or stale');
        DisplayRow.Get('A-4B');
        Assert.AreEqual('Gry Green', DisplayRow."Owner Display",
            'Expected the newly added assignment to appear with its own owner''s name after a rebuild');
    end;

    [Test]
    procedure BuildRowsLeavesTheDisplayBlankWhenNoMatchingPersonOrTeamExists()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        // Deliberately no "CG X133 Team" row for 'TEAM-5' and no
        // "CG X133 Person" row for 'P-5' - the assignment references master
        // data that does not exist.
        SeedAssignment('A-5', 'TEAM-5', 'P-5', 9);

        DisplayRowBuilder.BuildRows('TEAM-5', DisplayRow);

        DisplayRow.Get('A-5');
        Assert.AreEqual('', DisplayRow."Owner Display",
            'Expected a blank owner display, not an error, when the owner code matches no person');
        Assert.AreEqual('', DisplayRow."Team Display",
            'Expected a blank team display, not an error, when the team code matches no team');
        Assert.AreEqual(9, DisplayRow.Priority,
            'Expected the priority to still carry through even when neither related name resolves');
    end;

    [Test]
    procedure BuildRowsProducesNoRowsForATeamWithNoAssignments()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DisplayRow: Record "CG X133 Display Row" temporary;
    begin
        ClearAll();
        SeedTeam('TEAM-6', 'Squad Six');

        DisplayRowBuilder.BuildRows('TEAM-6', DisplayRow);

        Assert.AreEqual(0, DisplayRow.Count(),
            'Expected no rows for a team with no assignments at all - and no error either');
    end;

    [Test]
    procedure BuildingALargeTeamsListCostsTheSameAsASmallOnes()
    var
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        WarmDisplayRow: Record "CG X133 Display Row" temporary;
        DisplayRow: Record "CG X133 Display Row" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        OwnerCode: Code[20];
        AssignmentNo: Code[20];
        i: Integer;
        AssignmentCount: Integer;
    begin
        ClearAll();
        AssignmentCount := 300;

        // Warm up on an unrelated, single-assignment team first, so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        SeedTeam('TEAM-WARM', 'Warm Squad');
        SeedPerson('P-WARM', 'Warm Owner');
        SeedAssignment('A-WARM', 'TEAM-WARM', 'P-WARM', 1);
        DisplayRowBuilder.BuildRows('TEAM-WARM', WarmDisplayRow);
        ClearAll();

        // A large team: 300 assignments, each with its own distinct owner -
        // a busy team's list, versus the one-assignment team measured above.
        SeedTeam('TEAM-BUSY', 'Busy Squad');
        for i := 1 to AssignmentCount do begin
            OwnerCode := CopyStr(StrSubstNo('P-BUSY-%1', i), 1, MaxStrLen(OwnerCode));
            AssignmentNo := CopyStr(StrSubstNo('A-BUSY-%1', i), 1, MaxStrLen(AssignmentNo));
            SeedPerson(OwnerCode, CopyStr(StrSubstNo('Owner %1 Name', i), 1, 100));
            SeedAssignment(AssignmentNo, 'TEAM-BUSY', OwnerCode, i);
        end;

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        DisplayRowBuilder.BuildRows('TEAM-BUSY', DisplayRow);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        DisplayRow.Get('A-BUSY-1');
        Assert.AreEqual('Owner 1 Name', DisplayRow."Owner Display",
            'Expected the correct owner name on the low-cost build before judging its cost');
        DisplayRow.Get('A-BUSY-300');
        Assert.AreEqual('Owner 300 Name', DisplayRow."Owner Display",
            'Expected the correct owner name on the low-cost build before judging its cost - including the last assignment in a large team');
        Assert.AreEqual('Busy Squad', DisplayRow."Team Display",
            'Expected the correct team name on the low-cost build before judging its cost');
        Assert.IsTrue(StatementsUsed <= X133MaxStatements(),
            StrSubstNo('Expected building a large team''s list to cost the same as a small one: budget %1, actual %2 against %3 assignments', X133MaxStatements(), StatementsUsed, AssignmentCount));
    end;

    // =================================================================
    // Workload indicator tests (distractor, correct both sides: CG X113)
    // =================================================================

    [Test]
    procedure HasPendingJobsIsTrueWhenAPendingJobExists()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-A', false);
        SeedEntry('D-A', true);
        SeedEntry('D-A', false);

        Assert.IsTrue(DispatchCheck.HasPendingJobs('D-A'),
            'Expected true from HasPendingJobs: the dispatcher has a pending job sitting between two closed ones, but the call returned false');
    end;

    [Test]
    procedure HasPendingJobsIsFalseWhenAllJobsAreClosed()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-B', false);
        SeedEntry('D-B', false);
        SeedEntry('D-B', false);

        Assert.IsFalse(DispatchCheck.HasPendingJobs('D-B'),
            'Expected false from HasPendingJobs: every job of this dispatcher is closed, and a closed job must not count as pending');
    end;

    [Test]
    procedure HasPendingJobsIsFalseForADispatcherWithNoJobs()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();

        Assert.IsFalse(DispatchCheck.HasPendingJobs('D-C'),
            'Expected false from HasPendingJobs for a dispatcher with no jobs at all - and no error: an empty queue is a normal input');
    end;

    [Test]
    procedure HasPendingJobsIgnoresOtherDispatchersPendingJobs()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-D', false);
        SeedEntry('D-NEIGHBOUR', true);

        Assert.IsFalse(DispatchCheck.HasPendingJobs('D-D'),
            'Expected false from HasPendingJobs: the only pending job belongs to a neighbour dispatcher and must not leak into this dispatcher''s answer');
    end;

    [Test]
    procedure IsUnassignedIsTrueWhenTheDispatcherHasNoJobs()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-NEIGHBOUR2', true);

        Assert.IsTrue(DispatchCheck.IsUnassigned('D-E'),
            'Expected true from IsUnassigned: this dispatcher has no jobs of their own - a neighbour dispatcher''s job must not count as activity');
    end;

    [Test]
    procedure IsUnassignedIsFalseWhenOnlyAClosedJobExists()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-F', false);

        Assert.IsFalse(DispatchCheck.IsUnassigned('D-F'),
            'Expected false from IsUnassigned: a single closed job is enough history - unassigned means no jobs at all, not no pending ones');
    end;

    [Test]
    procedure IsUnassignedIsFalseWhenAPendingJobExists()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-G', true);

        Assert.IsFalse(DispatchCheck.IsUnassigned('D-G'),
            'Expected false from IsUnassigned: the dispatcher has a pending job, which is certainly a job');
    end;

    [Test]
    procedure PendingJobCountCountsExactlyThePendingJobs()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
        Any: Codeunit Any;
        PendingCount: Integer;
        ClosedCount: Integer;
        i: Integer;
    begin
        ClearAllEntries();
        Any.SetSeed(113);
        PendingCount := Any.IntegerInRange(3, 9);
        ClosedCount := Any.IntegerInRange(2, 6);
        for i := 1 to PendingCount do
            SeedEntry('D-H', true);
        for i := 1 to ClosedCount do
            SeedEntry('D-H', false);
        SeedEntry('D-NEIGHBOUR3', true);

        Assert.AreEqual(PendingCount, DispatchCheck.PendingJobCount('D-H'),
            'Expected PendingJobCount to count exactly this dispatcher''s own pending jobs - closed jobs and the neighbour dispatcher''s pending job must not be counted');
    end;

    [Test]
    procedure PendingJobCountIsZeroWhenNothingIsPending()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();
        SeedEntry('D-I', false);
        SeedEntry('D-I', false);

        Assert.AreEqual(0, DispatchCheck.PendingJobCount('D-I'),
            'Expected 0 from PendingJobCount when the dispatcher''s jobs are all closed - and no error either');
    end;

    [Test]
    procedure AnswersReflectAJobAddedSinceTheLastLook()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
    begin
        ClearAllEntries();

        Assert.IsTrue(DispatchCheck.IsUnassigned('D-J'),
            'Expected true from IsUnassigned before any job existed for this dispatcher');

        SeedEntry('D-J', true);

        Assert.IsFalse(DispatchCheck.IsUnassigned('D-J'),
            'Expected the same check, asked again after a job was added, to reflect the new job rather than repeat its earlier answer');
        Assert.IsTrue(DispatchCheck.HasPendingJobs('D-J'),
            'Expected HasPendingJobs to see the job added since the last look, not repeat an earlier answer');
        Assert.AreEqual(1, DispatchCheck.PendingJobCount('D-J'),
            'Expected PendingJobCount to see the job added since the last look, not repeat an earlier answer');
    end;

    [Test]
    procedure BusyDispatcherRowCostsTheSameAsAQuietOne()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
        Any: Codeunit Any;
        ClosedCount: Integer;
        i: Integer;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
        Answer: Boolean;
    begin
        ClearAllEntries();
        Any.SetSeed(113);
        ClosedCount := Any.IntegerInRange(180, 220);

        // Warm up on an unrelated dispatcher first, and only seed the graded
        // dispatcher's jobs afterward - the graded call must answer a
        // question this codeunit instance has never been asked before, not
        // repeat an answer it already computed.
        SeedEntry('D-WARM1', true);
        DispatchCheck.HasPendingJobs('D-WARM1');
        ClearAllEntries();

        for i := 1 to ClosedCount do
            SeedEntry('D-BUSY1', false);
        SeedEntry('D-BUSY1', true); // the one pending job lands after every closed one
        InvalidateDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        RowsBefore := SessionInformation.SqlRowsRead();
        Answer := DispatchCheck.HasPendingJobs('D-BUSY1');
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.IsTrue(Answer,
            StrSubstNo('Expected true from HasPendingJobs: one of this dispatcher''s %1 jobs is pending', ClosedCount + 1));
        Assert.IsTrue(RowsUsed <= X113MaxRows(),
            StrSubstNo('Expected checking for pending jobs to cost the same for a busy dispatcher as for a quiet one: budget %1, actual %2 against %3 jobs', X113MaxRows(), RowsUsed, ClosedCount + 1));
        Assert.IsTrue(StatementsUsed <= X113MaxStatements(),
            StrSubstNo('Expected checking for pending jobs to cost the same for a busy dispatcher as for a quiet one: budget %1, actual %2 against %3 jobs', X113MaxStatements(), StatementsUsed, ClosedCount + 1));
    end;

    [Test]
    procedure HavingAnyJobsAtAllIsAnswerableAtAnyVolume()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
        Any: Codeunit Any;
        EntryCount: Integer;
        i: Integer;
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
        Answer: Boolean;
    begin
        ClearAllEntries();
        Any.SetSeed(113);
        EntryCount := Any.IntegerInRange(140, 180);

        // Warm up on an unrelated dispatcher first, and only seed the graded
        // dispatcher's jobs afterward - the graded call must answer a
        // question this codeunit instance has never been asked before, not
        // repeat an answer it already computed.
        SeedEntry('D-WARM2', true);
        DispatchCheck.IsUnassigned('D-WARM2');
        ClearAllEntries();

        for i := 1 to EntryCount do
            SeedEntry('D-BUSY2', i mod 2 = 0);
        InvalidateDataCache();
        RowsBefore := SessionInformation.SqlRowsRead();
        Answer := DispatchCheck.IsUnassigned('D-BUSY2');
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.IsFalse(Answer,
            StrSubstNo('Expected false from IsUnassigned: the dispatcher holds %1 jobs', EntryCount));
        Assert.IsTrue(RowsUsed <= X113MaxRows(),
            StrSubstNo('Expected checking whether a dispatcher has any jobs at all to cost the same at any volume: budget %1, actual %2 against %3 jobs', X113MaxRows(), RowsUsed, EntryCount));
    end;

    [Test]
    procedure TheJobTotalIsAnswerableAtAnyVolume()
    var
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
        Any: Codeunit Any;
        PendingCount: Integer;
        ClosedCount: Integer;
        i: Integer;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
        Answer: Integer;
    begin
        ClearAllEntries();
        Any.SetSeed(113);
        PendingCount := Any.IntegerInRange(120, 160);
        ClosedCount := Any.IntegerInRange(30, 50);

        // Warm up on an unrelated dispatcher first, and only seed the graded
        // dispatcher's jobs afterward - the graded call must answer a
        // question this codeunit instance has never been asked before, not
        // repeat an answer it already computed.
        SeedEntry('D-WARM3', true);
        DispatchCheck.PendingJobCount('D-WARM3');
        ClearAllEntries();

        for i := 1 to PendingCount do
            SeedEntry('D-BUSY3', true);
        for i := 1 to ClosedCount do
            SeedEntry('D-BUSY3', false);
        InvalidateDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        RowsBefore := SessionInformation.SqlRowsRead();
        Answer := DispatchCheck.PendingJobCount('D-BUSY3');
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.AreEqual(PendingCount, Answer,
            'Expected the exact job total before judging the cost - cheap must not mean wrong');
        Assert.IsTrue(RowsUsed <= X113MaxRows(),
            StrSubstNo('Expected the pending-job total to cost the same at any volume: budget %1, actual %2 against %3 jobs', X113MaxRows(), RowsUsed, PendingCount + ClosedCount));
        Assert.IsTrue(StatementsUsed <= X113MaxStatements(),
            StrSubstNo('Expected the pending-job total to cost the same at any volume: budget %1, actual %2 against %3 jobs', X113MaxStatements(), StatementsUsed, PendingCount + ClosedCount));
    end;

    // =================================================================
    // Latest-activity indicator tests (distractor, correct both sides:
    // CG X109)
    // =================================================================

    [Test]
    procedure ReturnsTheEntryWithTheHighestEntryNo()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
        LatestAmount: Decimal;
        LatestEntryNo: Integer;
    begin
        ClearAll();
        MockEntry('CG-X109-D1', Any.DecimalInRange(500, 900, 2));
        MockEntry('CG-X109-D1', Any.DecimalInRange(500, 900, 2));
        // the newest entry deliberately carries the smallest amount, so
        // "biggest amount" is not the same question as "latest entry"
        LatestAmount := Any.DecimalInRange(100, 400, 2);
        LatestEntryNo := MockEntry('CG-X109-D1', LatestAmount);

        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D1', ActivityEntry),
            'Expected a latest entry to be found for a document that has entries');
        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the most recently posted entry to be returned, whatever its amount');
        Assert.AreEqual(LatestAmount, ActivityEntry.Amount,
            'Expected the returned record to carry the latest entry''s own data');
    end;

    [Test]
    procedure IgnoresNewerEntriesOfOtherDocuments()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
        OwnAmount: Decimal;
        OwnEntryNo: Integer;
    begin
        ClearAll();
        OwnAmount := Any.DecimalInRange(100, 900, 2);
        OwnEntryNo := MockEntry('CG-X109-D2A', OwnAmount);
        MockEntry('CG-X109-D2B', Any.DecimalInRange(100, 900, 2));

        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D2A', ActivityEntry),
            'Expected the requested document''s own entry to be found');
        Assert.AreEqual(OwnEntryNo, ActivityEntry."Entry No.",
            'Expected the requested document''s own latest entry - a newer entry posted under a different document must not win');
        Assert.AreEqual(OwnAmount, ActivityEntry.Amount,
            'Expected the amount of the requested document''s own entry, not another document''s');
    end;

    [Test]
    procedure ReturnsFalseWhenTheDocumentHasNoEntries()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
    begin
        ClearAll();
        MockEntry('CG-X109-D3-OTHER', Any.DecimalInRange(100, 900, 2));

        Assert.IsFalse(EntryFinder.FindLatest('CG-X109-D3', ActivityEntry),
            'Expected no entry to be found for a document with none of its own, even while other documents have entries');
    end;

    [Test]
    procedure StaysWithinTheRowBudgetForAnEntryHeavyDocument()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        MaxRows: Integer;
        LatestEntryNo: Integer;
        i: Integer;
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
    begin
        ClearAll();
        MaxRows := 20;

        // Warm-up runs against its own small, unrelated document so
        // first-touch metadata/plan loading lands outside the measurement
        // window below, and so a per-document cache of results could not
        // possibly hold an answer for the document graded next.
        MockEntry('CG-X109-D4-WARM', 10);
        EntryFinder.FindLatest('CG-X109-D4-WARM', ActivityEntry);

        // The graded document is seeded only now, after the warm-up, so the
        // measured call below is that document's first-ever lookup.
        for i := 1 to 200 do
            LatestEntryNo := MockEntry('CG-X109-D4', 10);
        DisturbCache();
        Clear(ActivityEntry);
        RowsBefore := SessionInformation.SqlRowsRead();
        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D4', ActivityEntry),
            'Expected the latest entry to be found before judging the cost');
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the cheap lookup to still return the correct latest entry - the right answer first, then the right cost');
        Assert.IsTrue(RowsUsed <= MaxRows,
            StrSubstNo('Expected the lookup to read at most %1 rows, but it read %2 for a document with 200 entries', MaxRows, RowsUsed));
    end;

    [Test]
    procedure StaysWithinTheStatementBudgetForAnEntryHeavyDocument()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        MaxStatements: Integer;
        LatestEntryNo: Integer;
        i: Integer;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
    begin
        ClearAll();
        MaxStatements := 20;

        // Warm-up runs against its own small, unrelated document, same
        // reasoning as the row-budget test above: it keeps one-time
        // metadata/plan costs out of the measurement window, and it means a
        // per-document cache of results could not hold an answer for the
        // document graded next.
        MockEntry('CG-X109-D5-WARM', 10);
        EntryFinder.FindLatest('CG-X109-D5-WARM', ActivityEntry);

        // The graded document is seeded only now, after the warm-up, so the
        // measured call below is that document's first-ever lookup.
        for i := 1 to 200 do
            LatestEntryNo := MockEntry('CG-X109-D5', 10);
        DisturbCache();
        Clear(ActivityEntry);
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D5', ActivityEntry),
            'Expected the latest entry to be found before judging the cost');
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the cheap lookup to still return the correct latest entry - the right answer first, then the right cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements,
            StrSubstNo('Expected the lookup to stay within its cost budget of %1, but it measured %2 for a document with 200 entries', MaxStatements, StatementsUsed));
    end;

    // =================================================================
    // Composed dashboard tests (glue: CG X143)
    // =================================================================

    [Test]
    procedure RefreshDashboardComposesEveryTileFromItsOwnCorrectSource()
    var
        DashboardMgt: Codeunit "CG X143 Dashboard Mgt";
        HistoryBuffer: Record "CG X134 History Buffer" temporary;
        DisplayRow: Record "CG X133 Display Row" temporary;
        Indicator: Record "CG X143 Dashboard Indicator" temporary;
    begin
        // [SCENARIO] One refresh call correctly wires every tile to its own
        // source, and one assignment's data never leaks into another's
        ClearAll();
        SeedApproval('APPR-COMPOSE', 'REQ-C1', 'Compose Request One', 111);
        SeedApproval('APPR-COMPOSE', 'REQ-C2', 'Compose Request Two', 222);

        SeedTeam('TEAM-COMPOSE', 'Compose Squad');
        SeedPerson('P-COMPOSE-A', 'Compose Owner A');
        SeedPerson('P-COMPOSE-B', 'Compose Owner B');
        SeedAssignment('A-COMPOSE-A', 'TEAM-COMPOSE', 'P-COMPOSE-A', 3);
        SeedAssignment('A-COMPOSE-B', 'TEAM-COMPOSE', 'P-COMPOSE-B', 5);

        SeedEntry('P-COMPOSE-A', true);
        SeedEntry('P-COMPOSE-B', false);

        MockEntry('A-COMPOSE-A', 77);
        MockEntry('A-COMPOSE-B', 88);

        DashboardMgt.RefreshDashboard('APPR-COMPOSE', 'TEAM-COMPOSE', HistoryBuffer, DisplayRow, Indicator);

        Assert.AreEqual(2, HistoryBuffer.Count(),
            'Expected the dashboard''s history feed to carry every one of this approver''s entries');
        AssertShown(HistoryBuffer, 'REQ-C1', 'Compose Request One', 111);
        AssertShown(HistoryBuffer, 'REQ-C2', 'Compose Request Two', 222);

        DisplayRow.Get('A-COMPOSE-A');
        Assert.AreEqual('Compose Owner A', DisplayRow."Owner Display",
            'Expected the dashboard''s assignment row to show the right owner display name');
        Assert.AreEqual('Compose Squad', DisplayRow."Team Display",
            'Expected the dashboard''s assignment row to show the right team display name');
        DisplayRow.Get('A-COMPOSE-B');
        Assert.AreEqual('Compose Owner B', DisplayRow."Owner Display",
            'Expected the dashboard''s second assignment row to show its own owner display name, not the first assignment''s');

        Indicator.Get('A-COMPOSE-A');
        Assert.IsTrue(Indicator."Has Pending Job",
            'Expected the dashboard''s workload indicator to reflect that this assignment''s owner has a pending job');
        Assert.AreEqual(77, Indicator."Latest Activity Amount",
            'Expected the dashboard''s latest-activity indicator to carry this assignment''s own most recent amount');

        Indicator.Get('A-COMPOSE-B');
        Assert.IsFalse(Indicator."Has Pending Job",
            'Expected the dashboard''s workload indicator to show no pending job when the owner''s only job is closed');
        Assert.AreEqual(88, Indicator."Latest Activity Amount",
            'Expected the dashboard''s second assignment''s latest-activity indicator to carry its own amount, not the first assignment''s');
    end;

    [Test]
    procedure RefreshingTheDashboardCostsNoMoreForALongTenuredApproverThanAnyoneElse()
    var
        DashboardMgt: Codeunit "CG X143 Dashboard Mgt";
        HistoryBuffer: Record "CG X134 History Buffer" temporary;
        WarmHistoryBuffer: Record "CG X134 History Buffer" temporary;
        DisplayRow: Record "CG X133 Display Row" temporary;
        WarmDisplayRow: Record "CG X133 Display Row" temporary;
        Indicator: Record "CG X143 Dashboard Indicator" temporary;
        WarmIndicator: Record "CG X143 Dashboard Indicator" temporary;
        Any: Codeunit Any;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        NSeed: Integer;
        RequestNo: Code[20];
        RequestDescription: Text[100];
        i: Integer;
    begin
        // [SCENARIO] Opening the whole dashboard for a long-tenured approver
        // costs no more than opening it for anyone else - the team side of
        // the dashboard is small and fixed, so only the approver's own
        // history can explain a slowdown
        ClearAll();

        // Warm-up on a DIFFERENT approver and a DIFFERENT team, cleared
        // before the graded data is seeded, so nothing the measured call
        // needs was resolved beforehand.
        SeedApproval('APPR-WARM-D', 'REQ-WARM-D1', 'Warmup Dashboard Request', 1);
        SeedTeam('TEAM-WARM-D', 'Warm Dashboard Squad');
        SeedPerson('P-WARM-D', 'Warm Dashboard Owner');
        SeedAssignment('A-WARM-D', 'TEAM-WARM-D', 'P-WARM-D', 1);
        SeedEntry('P-WARM-D', true);
        MockEntry('A-WARM-D', 1);
        DashboardMgt.RefreshDashboard('APPR-WARM-D', 'TEAM-WARM-D', WarmHistoryBuffer, WarmDisplayRow, WarmIndicator);
        ClearAll();

        // The graded team is a single assignment - small and constant - so
        // the assignment list, workload, and latest-activity tiles stay
        // cheap regardless of what the history tile does; only the
        // approver's own history grows below.
        SeedTeam('TEAM-DASH', 'Dashboard Squad');
        SeedPerson('P-DASH', 'Dashboard Owner');
        SeedAssignment('A-DASH', 'TEAM-DASH', 'P-DASH', 1);
        SeedEntry('P-DASH', true);
        MockEntry('A-DASH', 42);

        Any.SetSeed(143);
        NSeed := Any.IntegerInRange(1400, 1500);
        for i := 1 to NSeed do begin
            RequestNo := CopyStr(StrSubstNo('REQ-DASH%1', i), 1, MaxStrLen(RequestNo));
            RequestDescription := CopyStr(StrSubstNo('Dashboard Request %1', i), 1, MaxStrLen(RequestDescription));
            SeedApproval('APPR-DASH-BUSY', RequestNo, RequestDescription, 9000 + i);
        end;

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        DashboardMgt.RefreshDashboard('APPR-DASH-BUSY', 'TEAM-DASH', HistoryBuffer, DisplayRow, Indicator);
        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        // Correctness inside the measured window, so a cheap-but-wrong
        // rewrite cannot pass on cost alone. Boundary literals pinned on
        // both sides of the history cutoff.
        Assert.AreEqual(20, HistoryBuffer.Count(),
            'Expected the dashboard''s history feed to stay at the most recent entries even for a long-tenured approver');
        AssertShown(HistoryBuffer, CopyStr(StrSubstNo('REQ-DASH%1', NSeed), 1, MaxStrLen(RequestNo)),
            CopyStr(StrSubstNo('Dashboard Request %1', NSeed), 1, MaxStrLen(RequestDescription)), 9000 + NSeed);
        AssertShown(HistoryBuffer, CopyStr(StrSubstNo('REQ-DASH%1', NSeed - 19), 1, MaxStrLen(RequestNo)),
            CopyStr(StrSubstNo('Dashboard Request %1', NSeed - 19), 1, MaxStrLen(RequestDescription)), 9000 + NSeed - 19);
        AssertNotShown(HistoryBuffer, CopyStr(StrSubstNo('REQ-DASH%1', NSeed - 20), 1, MaxStrLen(RequestNo)));
        AssertNotShown(HistoryBuffer, 'REQ-DASH1');

        DisplayRow.Get('A-DASH');
        Assert.AreEqual('Dashboard Owner', DisplayRow."Owner Display",
            'Expected the dashboard''s assignment row to still show the right owner name before judging cost');
        Assert.AreEqual('Dashboard Squad', DisplayRow."Team Display",
            'Expected the dashboard''s assignment row to still show the right team name before judging cost');

        Indicator.Get('A-DASH');
        Assert.IsTrue(Indicator."Has Pending Job",
            'Expected the dashboard''s workload indicator to still be correct before judging cost');
        Assert.AreEqual(42, Indicator."Latest Activity Amount",
            'Expected the dashboard''s latest-activity indicator to still be correct before judging cost');

        Assert.IsTrue(StmtDelta <= 120,
            StrSubstNo('Opening the dashboard must not get slower as one approver''s history grows: allowed %1, actual %2 for %3 history entries', 120, StmtDelta, NSeed));
    end;

    [Test]
    procedure RefreshingForAnotherTeamReplacesEveryTileNotJustSome()
    var
        DashboardMgt: Codeunit "CG X143 Dashboard Mgt";
        HistoryBuffer: Record "CG X134 History Buffer" temporary;
        DisplayRow: Record "CG X133 Display Row" temporary;
        Indicator: Record "CG X143 Dashboard Indicator" temporary;
    begin
        // [SCENARIO] Refreshing the dashboard a second time, for a
        // different team, replaces every team-dependent tile - not just
        // the ones a narrower rewrite happens to touch
        ClearAll();

        SeedTeam('TEAM-SWITCH-ONE', 'Switch Squad One');
        SeedPerson('P-SWITCH-ONE', 'Switch Owner One');
        SeedAssignment('A-SWITCH-ONE', 'TEAM-SWITCH-ONE', 'P-SWITCH-ONE', 1);
        SeedEntry('P-SWITCH-ONE', true);
        MockEntry('A-SWITCH-ONE', 111);

        SeedTeam('TEAM-SWITCH-TWO', 'Switch Squad Two');
        SeedPerson('P-SWITCH-TWO', 'Switch Owner Two');
        SeedAssignment('A-SWITCH-TWO', 'TEAM-SWITCH-TWO', 'P-SWITCH-TWO', 2);
        SeedEntry('P-SWITCH-TWO', false);
        MockEntry('A-SWITCH-TWO', 222);

        DashboardMgt.RefreshDashboard('APPR-SWITCH', 'TEAM-SWITCH-ONE', HistoryBuffer, DisplayRow, Indicator);
        Assert.AreEqual(1, Indicator.Count(),
            'Expected the first refresh to carry exactly one indicator row before judging the second refresh');

        // Reuse the SAME buffer variables for a second refresh, for a
        // DIFFERENT team - a rewrite that clears one tile but not another
        // would leave the first team's stale indicator sitting alongside
        // the second team's.
        DashboardMgt.RefreshDashboard('APPR-SWITCH', 'TEAM-SWITCH-TWO', HistoryBuffer, DisplayRow, Indicator);

        DisplayRow.Reset();
        Assert.IsTrue(DisplayRow.Get('A-SWITCH-TWO'),
            'Expected the display list to hold the new team''s own assignment after the second refresh');
        Assert.AreEqual(2, DisplayRow.Count(),
            'Expected the display list to still hold both teams'' assignments after a second refresh for a different team, matching how the assignment list already accumulates across teams');

        Indicator.Reset();
        Assert.AreEqual(1, Indicator.Count(),
            'Expected refreshing for a different team to replace the indicator buffer, not add to it');
        Indicator.Get('A-SWITCH-TWO');
        Assert.IsFalse(Indicator."Has Pending Job",
            'Expected the indicator buffer to carry the new team''s own pending-job status, not the previous team''s');
        Assert.AreEqual(222, Indicator."Latest Activity Amount",
            'Expected the indicator buffer to carry the new team''s own latest-activity amount, not the previous team''s');
        Assert.IsFalse(Indicator.Get('A-SWITCH-ONE'),
            'Expected the indicator buffer to no longer hold an entry for the previous team''s assignment');
    end;
}
