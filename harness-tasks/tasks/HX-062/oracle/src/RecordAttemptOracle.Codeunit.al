codeunit 86700 "HX062 Record Attempt Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure DeliveredEntryOneAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX062 Endpoint";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
        Delivered: Boolean;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX062-1A');
        BindSubscription(Endpoint);

        Delivered := Dispatcher.DispatchEntry(EntryNo);

        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'DispatchEntry counts one attempt');
        Assert.IsTrue(Delivered, 'The delivered entry returns true');
        Assert.IsTrue(Entry.Sent, 'The delivered entry is sent');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'Last Attempt At is set');
        Assert.AreEqual('', Entry."Last Error", 'No error on a delivered entry');
    end;

    [Test]
    procedure RecordAttemptCountsAndReturns()
    var
        Entry: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
        First: Integer;
        Second: Integer;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX062-2B');
        Entry.Get(EntryNo);
        Assert.AreEqual(0, Entry.Attempts, 'Precondition: a queued entry has no attempt');
        Assert.AreEqual(0DT, Entry."Last Attempt At", 'Precondition: a queued entry has no attempt time');

        First := Dispatcher.RecordAttempt(EntryNo);
        Second := Dispatcher.RecordAttempt(EntryNo);

        Assert.AreEqual(1, First, 'The first RecordAttempt returns the new count 1');
        Assert.AreEqual(2, Second, 'The second RecordAttempt returns the new count 2');
        Entry.Get(EntryNo);
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts are stored');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'Last Attempt At is set');
        Assert.IsFalse(Entry.Sent, 'Counting an attempt does not send the entry');
    end;

    [Test]
    procedure AttemptSurvivesLaterError()
    var
        Entry: Record "CGR Outbox Entry";
        Runner: Codeunit "HX062 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX062-3C');

        Runner.SetRecordAttemptThenFail(EntryNo);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'The later step fails the transaction');
        Assert.AreEqual('HX062 later step failed.', RunError, 'The later step''s error ends the run');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'The counted attempt survives the later error');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'The attempt time survives the later error');
    end;

    [Test]
    procedure RefusedOutcomeKeepsAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX062 Endpoint";
        Guard: Codeunit "HX062 Outcome Guard";
        Runner: Codeunit "HX062 Dispatch Runner";
        EntryNo: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX062-4D');
        BindSubscription(Endpoint);
        Guard.GuardVehicle('HX062-4D');
        BindSubscription(Guard);

        Runner.SetDispatch(EntryNo);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();
        UnbindSubscription(Guard);

        Assert.IsFalse(Ok, 'The refused outcome update fails DispatchEntry');
        Assert.AreEqual('HX062 outcome refused for HX062-4D.', RunError, 'The guard refused the outcome');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'The attempt survives the refused outcome');
        Assert.IsFalse(Entry.Sent, 'The refused outcome is not stored');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'The attempt time survives the refused outcome');
    end;

    [Test]
    procedure FailsAtAttemptLimit()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX062 Endpoint";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
        Delivered: Boolean;
    begin
        InitRun(1);
        EntryNo := QueueEntry('HX062-5E');
        Endpoint.RejectVehicle('HX062-5E');
        BindSubscription(Endpoint);

        Delivered := Dispatcher.DispatchEntry(EntryNo);
        RestoreSetup();

        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.IsFalse(Delivered, 'The rejected entry is not delivered');
        Assert.IsTrue(Entry.Failed, 'The entry fails at the attempt limit 1');
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.AreEqual('Endpoint rejected vehicle HX062-5E.', Entry."Last Error", 'Rejection text kept');
    end;

    [Test]
    procedure UnknownEntryRaises()
    var
        Entry: Record "CGR Outbox Entry";
        Runner: Codeunit "HX062 Dispatch Runner";
        MissingNo: Integer;
        Ok: Boolean;
        RunError: Text;
        NotFoundPrefixTxt: Label 'The CGR Outbox Entry does not exist. Identification fields and values: Entry No.=', Locked = true;
    begin
        InitRun(3);
        MissingNo := 1000;
        if Entry.FindLast() then
            MissingNo := Entry."Entry No." + 1000;

        Runner.SetRecordAttempt(MissingNo);
        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsFalse(Ok, 'RecordAttempt for an unknown entry raises');
        Assert.IsTrue(RunError.StartsWith(NotFoundPrefixTxt), 'The platform''s not-found error: ' + RunError);
        Assert.IsFalse(Entry.Get(MissingNo), 'No entry is created for an unknown number');
    end;

    [Test]
    procedure SecondAttemptCounted()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX062 Endpoint";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        InitRun(3);
        EntryNo := QueueEntry('HX062-7F');
        Endpoint.RejectVehicle('HX062-7F');
        BindSubscription(Endpoint);

        Dispatcher.DispatchEntry(EntryNo);
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'Precondition: the first rejected dispatch counts one attempt');

        Dispatcher.DispatchEntry(EntryNo);

        Entry.Get(EntryNo);
        Assert.AreEqual(2, Entry.Attempts, 'The second dispatch counts a second attempt');
        Assert.IsFalse(Entry.Failed, 'Two rejections are below the attempt limit 3');
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.AreEqual('Endpoint rejected vehicle HX062-7F.', Entry."Last Error", 'Rejection text kept');
    end;

    [Test]
    procedure PendingThroughRecordAttempt()
    var
        Entry: Record "CGR Outbox Entry";
        Endpoint: Codeunit "HX062 Endpoint";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        GNo: Integer;
        HNo: Integer;
        SNo: Integer;
        Delivered: Integer;
    begin
        InitRun(3);
        GNo := QueueEntry('HX062-8G');
        HNo := QueueEntry('HX062-8H');
        SNo := QueueEntry('HX062-8S');
        Entry.Get(SNo);
        Entry.Sent := true;
        Entry.Modify();
        BindSubscription(Endpoint);

        Entry.Reset();
        Entry.SetFilter("Vehicle No.", 'HX062-8*');
        Delivered := Dispatcher.DispatchPending(Entry);

        Assert.AreEqual(2, Delivered, 'Both pending entries are delivered');
        Entry.Get(GNo);
        Assert.AreEqual(1, Entry.Attempts, 'G: one attempt');
        Assert.IsTrue(Entry.Sent, 'G is sent');
        Entry.Get(HNo);
        Assert.AreEqual(1, Entry.Attempts, 'H: one attempt');
        Assert.IsTrue(Entry.Sent, 'H is sent');
        Entry.Get(SNo);
        Assert.AreEqual(0, Entry.Attempts, 'The sent entry is not dispatched again');
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
        Entry.SetFilter("Vehicle No.", 'HX062-*');
        Entry.DeleteAll();
    end;

    local procedure RestoreSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        // DispatchEntry committed this row's attempt limit; put the default back, committed.
        Setup.GetOrCreate();
        Setup."Outbox Max Attempts" := 3;
        Setup.Modify();
        SessionContext.Reset();
        Commit();
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
