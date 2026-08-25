codeunit 89307 "CG-AL-X113 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the table before seeding its own rows.

    local procedure ClearAllEntries()
    var
        DispatchEntry: Record "CG X113 Dispatch Entry";
    begin
        DispatchEntry.DeleteAll();
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

    local procedure MaxStatements(): Integer
    begin
        exit(5);
    end;

    local procedure MaxRows(): Integer
    begin
        exit(10);
    end;

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
        Assert.IsTrue(RowsUsed <= MaxRows(),
            StrSubstNo('Expected checking for pending jobs to cost the same for a busy dispatcher as for a quiet one: budget %1, actual %2 against %3 jobs', MaxRows(), RowsUsed, ClosedCount + 1));
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected checking for pending jobs to cost the same for a busy dispatcher as for a quiet one: budget %1, actual %2 against %3 jobs', MaxStatements(), StatementsUsed, ClosedCount + 1));
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
        Assert.IsTrue(RowsUsed <= MaxRows(),
            StrSubstNo('Expected checking whether a dispatcher has any jobs at all to cost the same at any volume: budget %1, actual %2 against %3 jobs', MaxRows(), RowsUsed, EntryCount));
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
        Assert.IsTrue(RowsUsed <= MaxRows(),
            StrSubstNo('Expected the pending-job total to cost the same at any volume: budget %1, actual %2 against %3 jobs', MaxRows(), RowsUsed, PendingCount + ClosedCount));
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected the pending-job total to cost the same at any volume: budget %1, actual %2 against %3 jobs', MaxStatements(), StatementsUsed, PendingCount + ClosedCount));
    end;
}
