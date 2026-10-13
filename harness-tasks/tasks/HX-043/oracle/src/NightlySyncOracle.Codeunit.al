codeunit 86320 "HX043 Nightly Sync Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        CommitProhibitedTxt: Label 'Commit is prohibited in the current scope. The operation cannot continue. Contact your system administrator.', Locked = true;

    [Test]
    procedure PendingEntriesDispatched()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        Facade: Codeunit "CGR Integration Facade";
        EntryA: Integer;
        EntryB: Integer;
        EntryD: Integer;
        SentEntry: Integer;
        FailedEntry: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX043-1A');
        EntryB := QueueEntry('HX043-1B');
        EntryD := InsertEntry('HX043-1D', 'hx043OtherEvent');
        SentEntry := QueueEntry('HX043-1S');
        Facade.MarkSent(SentEntry);
        FailedEntry := QueueEntry('HX043-1F');
        Entry.Get(FailedEntry);
        Entry.Attempts := 3;
        Entry.Failed := true;
        Entry.Modify();
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The nightly run completes: ' + GetLastErrorText());
        Assert.AreEqual(3, Runner.LastResult(), 'The three pending entries are delivered');
        Entry.Get(EntryA);
        Assert.IsTrue(Entry.Sent, 'Entry A is sent');
        Assert.AreEqual(1, Entry.Attempts, 'Entry A has one attempt');
        Entry.Get(EntryB);
        Assert.IsTrue(Entry.Sent, 'Entry B is sent');
        Assert.AreEqual(1, Entry.Attempts, 'Entry B has one attempt');
        Entry.Get(EntryD);
        Assert.IsTrue(Entry.Sent, 'A pending entry of another event type is sent');
        Assert.AreEqual(1, Entry.Attempts, 'Entry D has one attempt');
        Entry.Get(SentEntry);
        Assert.IsTrue(Entry.Sent, 'The already sent entry stays sent');
        Assert.AreEqual(0, Entry.Attempts, 'The already sent entry is not dispatched again');
        Assert.IsFalse(Entry.Failed, 'The already sent entry does not fail');
        Entry.Get(FailedEntry);
        Assert.IsFalse(Entry.Sent, 'The failed entry is not sent');
        Assert.IsTrue(Entry.Failed, 'The failed entry stays failed');
        Assert.AreEqual(3, Entry.Attempts, 'The failed entry is not dispatched again');
        Assert.AreEqual(RunsBefore + 1, SyncRun.Count(), 'One run row is kept');
        SyncRun.FindLast();
        Assert.IsTrue(SyncRun.Completed, 'The run is completed');
        Assert.AreEqual(3, SyncRun.Dispatched, 'The run records three delivered entries');
        Assert.AreNotEqual(0DT, SyncRun."Started At", 'The run records when it started');
    end;

    [Test]
    procedure FailedSendKeepsAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        EntryA: Integer;
        EntryB: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX043-2A');
        EntryB := QueueEntry('HX043-2B');
        Partner.FailSendFor('HX043-2B');
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A failed send does not fail the nightly run: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.LastResult(), 'One entry delivered');
        Entry.Get(EntryA);
        Assert.IsTrue(Entry.Sent, 'Entry A is sent');
        Entry.Get(EntryB);
        Assert.IsFalse(Entry.Sent, 'Entry B is not sent');
        Assert.IsFalse(Entry.Failed, 'One failure is below the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'Entry B''s attempt is kept');
        Assert.AreEqual('HX043 send failed for HX043-2B.', Entry."Last Error", 'Entry B keeps the send error');
        Assert.AreEqual(RunsBefore + 1, SyncRun.Count(), 'One run row is kept');
        SyncRun.FindLast();
        Assert.AreEqual(1, SyncRun.Dispatched, 'The run records one delivered entry');
        Assert.IsTrue(SyncRun.Completed, 'The run is completed');
    end;

    [Test]
    procedure CommittingPreparationFailsRun()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        EntryA: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX043-3A');
        Partner.SetPreparation('HX043-3C', true, false);
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A preparation that commits fails the nightly run');
        Assert.AreEqual(CommitProhibitedTxt, GetLastErrorText(), 'The run fails with the platform''s commit error');
        Entry.SetRange("Vehicle No.", 'HX043-3C');
        Assert.IsTrue(Entry.IsEmpty(), 'The entry queued by the preparation is not kept');
        Assert.AreEqual(RunsBefore, SyncRun.Count(), 'No run row is kept');
        Entry.Get(EntryA);
        Assert.AreEqual(0, Entry.Attempts, 'No dispatch attempt is kept');
        Assert.AreEqual(0DT, Entry."Last Attempt At", 'No attempt time is kept');
        Assert.IsFalse(Entry.Sent, 'Entry A is not sent');
    end;

    [Test]
    procedure FailingPreparationKeepsNothing()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        EntryA: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX043-4A');
        Partner.SetPreparation('HX043-4C', false, true);
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A preparation that fails fails the nightly run');
        Assert.AreEqual('HX043 preparation failed.', GetLastErrorText(), 'The run fails with the preparation''s error');
        Entry.SetRange("Vehicle No.", 'HX043-4C');
        Assert.IsTrue(Entry.IsEmpty(), 'The entry queued by the preparation is not kept');
        Assert.AreEqual(RunsBefore, SyncRun.Count(), 'No run row is kept');
        Entry.Get(EntryA);
        Assert.AreEqual(0, Entry.Attempts, 'No dispatch attempt is kept');
        Assert.AreEqual(0DT, Entry."Last Attempt At", 'No attempt time is kept');
        Assert.IsFalse(Entry.Sent, 'Entry A is not sent');
    end;

    [Test]
    procedure PreparedEntryDispatchedSameRun()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        EntryA: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        EntryA := QueueEntry('HX043-5A');
        Partner.SetPreparation('HX043-5C', false, false);
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The nightly run completes: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.LastResult(), 'The prepared entry is delivered with the pending one');
        Entry.SetRange("Vehicle No.", 'HX043-5C');
        Assert.IsTrue(Entry.FindFirst(), 'The prepared entry is kept');
        Assert.IsTrue(Entry.Sent, 'The prepared entry is sent in the same run');
        Assert.AreEqual(1, Entry.Attempts, 'The prepared entry has one attempt');
        Entry.Get(EntryA);
        Assert.IsTrue(Entry.Sent, 'Entry A is sent');
        Assert.AreEqual(RunsBefore + 1, SyncRun.Count(), 'One run row is kept');
        SyncRun.FindLast();
        Assert.AreEqual(2, SyncRun.Dispatched, 'The run records two delivered entries');
        Assert.IsTrue(SyncRun.Completed, 'The run is completed');
        Assert.AreEqual(1, Partner.PreparationCalls(), 'The run is prepared once');
        Assert.AreEqual(SyncRun."Run No.", Partner.PreparedRunNo(), 'The preparation gets the kept run row');
        Assert.IsTrue(Partner.PreparedRunInTable(), 'The run row is inserted, not completed and has its start time before the preparation');
        Assert.IsFalse(Partner.PreparedRunCompleted(), 'The prepared run is not completed yet');
        Assert.AreNotEqual(0DT, Partner.PreparedRunStartedAt(), 'The prepared run has its start time');
    end;

    [Test]
    procedure NothingPendingCompletes()
    var
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(3);
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'The nightly run completes with nothing pending: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.LastResult(), 'Nothing delivered');
        Assert.AreEqual(RunsBefore + 1, SyncRun.Count(), 'One run row is kept');
        SyncRun.FindLast();
        Assert.IsTrue(SyncRun.Completed, 'The run is completed');
        Assert.AreEqual(0, SyncRun.Dispatched, 'The run records no delivered entry');
    end;

    [Test]
    procedure FailedEntryAtMaxAttempts()
    var
        Entry: Record "CGR Outbox Entry";
        SyncRun: Record "CGR Nightly Sync Run";
        Partner: Codeunit "HX043 Sync Partner";
        Runner: Codeunit "HX043 Sync Runner";
        EntryB: Integer;
        RunsBefore: Integer;
        Ok: Boolean;
    begin
        InitRun(1);
        EntryB := QueueEntry('HX043-7B');
        Partner.FailSendFor('HX043-7B');
        BindSubscription(Partner);
        RunsBefore := SyncRun.Count();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A failed send does not fail the nightly run: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.LastResult(), 'Nothing delivered');
        Entry.Get(EntryB);
        Assert.IsTrue(Entry.Failed, 'The entry fails at the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.IsFalse(Entry.Sent, 'The entry is not sent');
        Assert.AreEqual(RunsBefore + 1, SyncRun.Count(), 'One run row is kept');
        SyncRun.FindLast();
        Assert.AreEqual(0, SyncRun.Dispatched, 'The run records no delivered entry');
        Assert.IsTrue(SyncRun.Completed, 'The run is completed');
    end;

    local procedure InitRun(MaxAttempts: Integer)
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := MaxAttempts;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Entry.DeleteAll();
    end;

    local procedure InsertEntry(VehicleNo: Code[20]; EventType: Text[50]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Event Type" := EventType;
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := '{"event":"hx043OtherEvent"}';
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
        exit(Entry."Entry No.");
    end;

    local procedure QueueEntry(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.FindLast();
        exit(Entry."Entry No.");
    end;
}
