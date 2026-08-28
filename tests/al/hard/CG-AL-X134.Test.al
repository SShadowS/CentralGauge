codeunit 89354 "CG-AL-X134 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears all three tables before seeding its own rows.

    local procedure ClearAll()
    var
        Payment: Record "CG X134 Payment";
        Request: Record "CG X134 Request";
        HistoryEntry: Record "CG X134 History Entry";
    begin
        Payment.DeleteAll();
        Request.DeleteAll();
        HistoryEntry.DeleteAll();
    end;

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
}
