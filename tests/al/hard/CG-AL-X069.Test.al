codeunit 88822 "CG-AL-X069 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (see tests/al/hard/CG-AL-X065.Test.al for the same note), so every
    // test clears both tables before seeding its own rows.

    local procedure ClearAll()
    var
        QueueEntry: Record "CG X069 Queue Entry";
        Source: Record "CG X069 Report Source";
    begin
        QueueEntry.DeleteAll();
        Source.DeleteAll();
    end;

    local procedure EnqueueAnnual(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Annual;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    local procedure EnqueueQuarterly(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Quarterly;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    local procedure EnqueueAdhoc(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Adhoc;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    [Test]
    procedure NothingGenuinelyDueReturnsFalse()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('S1', 20260901D); // after cutoff, not due
        EnqueueQuarterly('S2', 20261015D); // after cutoff, not due
        EnqueueAdhoc('S3', 20260101D); // well before cutoff, but wrong type

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A period end with no genuinely due Annual/Quarterly reference must report nothing pending');
    end;

    [Test]
    procedure OneDueEntryAmongManyNotYetDueReturnsTrue()
    var
        Process: Codeunit "CG X069 Reference Process";
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 5 do
            EnqueueAnnual(StrSubstNo('N%1', i), 20261101D); // future, not due
        EnqueueQuarterly('DUE', 20260615D); // due

        Assert.IsTrue(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A genuinely due reference among several not-yet-due entries must be reported as pending');
    end;

    [Test]
    procedure ExactCutoffDateCountsAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('EDGE', 20260831D);

        Assert.IsTrue(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference dated exactly on the period end date must count as due');
    end;

    [Test]
    procedure DayAfterCutoffIsNotYetDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('EDGE2', 20260901D);

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference dated one day after the period end date must not count as due yet');
    end;

    [Test]
    procedure AdhocReferencesAreNeverReportedAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAdhoc('ADH', 20260101D); // long overdue by date, but wrong type

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'An Adhoc reference must never be reported as a pending Annual/Quarterly obligation, however old its date');
    end;

    [Test]
    procedure UndatedSourceIsNeverReportedAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('NODATE', 0D);

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference whose source carries no posting date must not be treated as due');
    end;

    [Test]
    procedure RemovedReferenceIsNoLongerReportedAsDue()
    var
        QueueEntry: Record "CG X069 Queue Entry";
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('REMOVED', 20260615D); // due, until it is processed off the queue

        QueueEntry.FindFirst();
        Process.RemoveReference(QueueEntry."Entry No.");

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference already processed and removed from the queue must no longer be reported as pending');
    end;

    [Test]
    procedure PendingCheckCostDoesNotScaleWithQueueBacklog()
    var
        Process: Codeunit "CG X069 Reference Process";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        WarmResult: Boolean;
        Result: Boolean;
        i: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the check once on a small, unrelated backlog so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        EnqueueAnnual('WARM', 20260101D);
        WarmResult := Process.HasPendingReferenceUpToPeriodEnd(20251231D);
        Assert.IsFalse(WarmResult, 'A reference dated after the period end must not be reported as pending');
        ClearAll();

        // A 200-entry backlog where nothing is genuinely due as of the
        // cutoff below - the case that must be scanned in full and cannot
        // return early.
        for i := 1 to 200 do
            if i mod 2 = 0 then
                EnqueueAnnual(StrSubstNo('B%1', i), 20261201D)
            else
                EnqueueQuarterly(StrSubstNo('B%1', i), 20261201D);

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Result := Process.HasPendingReferenceUpToPeriodEnd(20260831D);

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.IsFalse(Result, 'A 200-entry backlog with nothing genuinely due must still report nothing pending');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('The check must not do work proportional to the queue backlog: statement budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('The check must not do work proportional to the queue backlog: rows budget %1, actual %2', 20, RowsDelta));
    end;
}
