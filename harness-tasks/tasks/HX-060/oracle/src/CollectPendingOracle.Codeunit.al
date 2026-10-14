codeunit 86660 "HX060 Collect Pending Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure CollectsOnlyPendingInFilter()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Pending: Record "CGR Outbox Entry" temporary;
        Stored: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        PendingNo: Integer;
        SecondPendingNo: Integer;
        SentNo: Integer;
        FailedNo: Integer;
        OutsideNo: Integer;
        Added: Integer;
    begin
        InitRun();
        PendingNo := QueueEntry('HX060-1A');
        SecondPendingNo := QueueEntry('HX060-1B');
        SentNo := QueueEntry('HX060-1S');
        MarkSent(SentNo);
        FailedNo := QueueEntry('HX060-1F');
        MarkFailed(FailedNo);
        OutsideNo := QueueEntry('HX060-2O');

        EntryFilter.SetFilter("Vehicle No.", 'HX060-1*');
        Added := Dispatcher.CollectPending(EntryFilter, Pending);

        Assert.AreEqual(2, Added, 'CollectPending returns the number of entries it added');
        Pending.Reset();
        Assert.AreEqual(2, Pending.Count(), 'Only the pending entries in the filter are collected');
        Assert.IsTrue(Pending.Get(SecondPendingNo), 'Every pending entry in the filter is collected');
        Assert.IsTrue(Pending.Get(PendingNo), 'The pending entry in the filter is collected under its own Entry No.');
        Stored.Get(PendingNo);
        Assert.AreEqual(Stored."Event Type", Pending."Event Type", 'Event Type copied');
        Assert.AreEqual(Stored."Vehicle No.", Pending."Vehicle No.", 'Vehicle No. copied');
        Assert.AreEqual(Stored.Payload, Pending.Payload, 'Payload copied');
        Assert.AreEqual(Stored."Created At", Pending."Created At", 'Created At copied');
        Assert.AreEqual(Stored.Sent, Pending.Sent, 'Sent copied');
        Assert.AreEqual(Stored.Attempts, Pending.Attempts, 'Attempts copied');
        Assert.AreEqual(Stored."Last Attempt At", Pending."Last Attempt At", 'Last Attempt At copied');
        Assert.AreEqual(Stored."Last Error", Pending."Last Error", 'Last Error copied');
        Assert.AreEqual(Stored.Failed, Pending.Failed, 'Failed copied');
        Assert.IsFalse(Pending.Get(SentNo), 'A sent entry is not collected');
        Assert.IsFalse(Pending.Get(FailedNo), 'A failed entry is not collected');
        Assert.IsFalse(Pending.Get(OutsideNo), 'A pending entry outside the filter is not collected');
    end;

    [Test]
    procedure CollectsAttemptedInFull()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Pending: Record "CGR Outbox Entry" temporary;
        Stored: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        AttemptedNo: Integer;
        Added: Integer;
    begin
        InitRun();
        AttemptedNo := QueueEntry('HX060-8A');
        HX60MarkAttempted(AttemptedNo);
        Stored.Get(AttemptedNo);
        Assert.AreEqual(2, Stored.Attempts, 'Precondition: the entry has two attempts');
        Assert.AreNotEqual(0DT, Stored."Last Attempt At", 'Precondition: the entry has a last attempt time');
        Assert.AreNotEqual('', Stored."Last Error", 'Precondition: the entry has a last error');
        Assert.IsFalse(Stored.Sent or Stored.Failed, 'Precondition: the attempted entry is still pending');

        EntryFilter.SetRange("Vehicle No.", 'HX060-8A');
        Added := Dispatcher.CollectPending(EntryFilter, Pending);

        Assert.AreEqual(1, Added, 'The attempted pending entry is collected');
        Pending.Reset();
        Assert.IsTrue(Pending.Get(AttemptedNo), 'The attempted entry is in Pending under its own Entry No.');
        Assert.AreEqual(Stored."Event Type", Pending."Event Type", 'Event Type copied');
        Assert.AreEqual(Stored."Vehicle No.", Pending."Vehicle No.", 'Vehicle No. copied');
        Assert.AreEqual(Stored.Payload, Pending.Payload, 'Payload copied');
        Assert.AreEqual(Stored."Created At", Pending."Created At", 'Created At copied');
        Assert.AreEqual(Stored.Sent, Pending.Sent, 'Sent copied');
        Assert.AreEqual(2, Pending.Attempts, 'Attempts copied');
        Assert.AreEqual(Stored."Last Attempt At", Pending."Last Attempt At", 'Last Attempt At copied');
        Assert.AreEqual('HX060 endpoint timed out', Pending."Last Error", 'Last Error copied');
        Assert.AreEqual(Stored.Failed, Pending.Failed, 'Failed copied');
    end;

    [Test]
    procedure KeepsCallerRows()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Pending: Record "CGR Outbox Entry" temporary;
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        PendingNo: Integer;
        Added: Integer;
    begin
        InitRun();
        PendingNo := QueueEntry('HX060-2A');
        Pending.Init();
        Pending."Entry No." := -5;
        Pending."Vehicle No." := 'HX060-2X';
        Pending.Payload := 'HX060 caller row';
        Pending.Insert();

        EntryFilter.SetRange("Vehicle No.", 'HX060-2A');
        Added := Dispatcher.CollectPending(EntryFilter, Pending);

        Assert.AreEqual(1, Added, 'Only the collected entry is counted, not the caller''s row');
        Pending.Reset();
        Assert.AreEqual(2, Pending.Count(), 'The caller''s row and the collected entry are both in Pending');
        Assert.IsTrue(Pending.Get(-5), 'The caller''s row stays in Pending');
        Assert.AreEqual('HX060 caller row', Pending.Payload, 'The caller''s row is unchanged');
        Assert.IsTrue(Pending.Get(PendingNo), 'The pending entry is added');
    end;

    [Test]
    procedure NoDuplicate()
    var
        Stored: Record "CGR Outbox Entry";
        Runner: Codeunit "HX060 Collect Runner";
        PendingNo: Integer;
        Ok: Boolean;
        RunError: Text;
    begin
        InitRun();
        PendingNo := QueueEntry('HX060-3A');
        QueueEntry('HX060-3B');
        Stored.Get(PendingNo);
        Runner.AddToBuffer(Stored);
        Runner.SetVehicleFilter('HX060-3*');

        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        Assert.IsTrue(Ok, 'An entry already in Pending does not make CollectPending fail: ' + RunError);
        Assert.AreEqual(1, Runner.Added(), 'Only the new pending entry is counted, not the one already in Pending');
        Assert.AreEqual(2, Runner.BufferCount(), 'The entry already in Pending is not added twice; the new one is added');
    end;

    [Test]
    procedure KeepsPendingFilters()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Pending: Record "CGR Outbox Entry" temporary;
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        PendingNo: Integer;
        Added: Integer;
        FiltersBefore: Text;
    begin
        InitRun();
        PendingNo := QueueEntry('HX060-4A');
        Pending.SetRange("Vehicle No.", 'HX060-Z');
        FiltersBefore := Pending.GetFilters();
        Assert.AreNotEqual('', FiltersBefore, 'Precondition: Pending carries the caller''s filter');

        EntryFilter.SetRange("Vehicle No.", 'HX060-4A');
        Added := Dispatcher.CollectPending(EntryFilter, Pending);

        Assert.AreEqual(1, Added, 'The pending entry is collected into a filtered buffer');
        Assert.AreEqual(FiltersBefore, Pending.GetFilters(), 'The caller''s filters on Pending are unchanged');
        Pending.Reset();
        Assert.IsTrue(Pending.Get(PendingNo), 'The entry is in Pending although it is outside Pending''s own filter');
    end;

    [Test]
    procedure KeepsEntryFilter()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Pending: Record "CGR Outbox Entry" temporary;
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        Added: Integer;
        FiltersBefore: Text;
    begin
        InitRun();
        QueueEntry('HX060-5A');
        EntryFilter.SetRange("Vehicle No.", 'HX060-5A');
        FiltersBefore := EntryFilter.GetFilters();

        Added := Dispatcher.CollectPending(EntryFilter, Pending);

        Assert.AreEqual(1, Added, 'The pending entry is collected');
        Assert.AreEqual(FiltersBefore, EntryFilter.GetFilters(), 'The filters on EntryFilter are unchanged');
    end;

    [Test]
    procedure DispatchPendingAsToday()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX060 Send Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        FirstNo: Integer;
        SecondNo: Integer;
        SentNo: Integer;
        FailedNo: Integer;
    begin
        InitRun();
        // The first entry's vehicle sorts after the second's, so only Entry No. order sends the first one first.
        FirstNo := QueueEntry('HX060-6B');
        SecondNo := QueueEntry('HX060-6A');
        SentNo := QueueEntry('HX060-6S');
        MarkSent(SentNo);
        FailedNo := QueueEntry('HX060-6F');
        MarkFailed(FailedNo);
        BindSubscription(Spy);

        EntryFilter.SetCurrentKey("Vehicle No.", "Entry No.");
        EntryFilter.SetFilter("Vehicle No.", 'HX060-6*');
        Assert.AreEqual(2, Dispatcher.DispatchPending(EntryFilter), 'Both pending entries are delivered');

        Entry.Get(FirstNo);
        Assert.IsTrue(Entry.Sent, 'The first pending entry is sent');
        Assert.AreEqual(1, Entry.Attempts, 'The first pending entry has one attempt');
        Entry.Get(SecondNo);
        Assert.IsTrue(Entry.Sent, 'The second pending entry is sent');
        Assert.AreEqual(1, Entry.Attempts, 'The second pending entry has one attempt');
        Entry.Get(SentNo);
        Assert.AreEqual(0, Entry.Attempts, 'A sent entry is not dispatched');
        Entry.Get(FailedNo);
        Assert.AreEqual(3, Entry.Attempts, 'A failed entry is not dispatched');
        Assert.IsFalse(Entry.Sent, 'A failed entry stays unsent');
        Assert.AreEqual(2, Spy.CallCount(), 'Only the two pending entries are sent');
        Assert.AreEqual(FirstNo, Spy.CallAt(1), 'Entries are sent in Entry No. order (first)');
        Assert.AreEqual(SecondNo, Spy.CallAt(2), 'Entries are sent in Entry No. order (second)');
    end;

    [Test]
    procedure DispatchPendingCountsDelivered()
    var
        EntryFilter: Record "CGR Outbox Entry";
        Entry: Record "CGR Outbox Entry";
        Spy: Codeunit "HX060 Send Spy";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        DeliveredNo: Integer;
        RejectedNo: Integer;
    begin
        InitRun();
        DeliveredNo := QueueEntry('HX060-7A');
        RejectedNo := QueueEntry('HX060-7B');
        Spy.RejectVehicle('HX060-7B');
        BindSubscription(Spy);

        EntryFilter.SetFilter("Vehicle No.", 'HX060-7*');
        Assert.AreEqual(1, Dispatcher.DispatchPending(EntryFilter), 'Only the delivered entry is counted');

        Entry.Get(DeliveredNo);
        Assert.IsTrue(Entry.Sent, 'The accepted entry is sent');
        Entry.Get(RejectedNo);
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One rejection is below the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'The rejected entry has one attempt');
        Assert.AreEqual('Endpoint rejected vehicle HX060-7B.', Entry."Last Error", 'Rejection text kept');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        Entry.SetFilter("Vehicle No.", 'HX060-*');
        Entry.DeleteAll();
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

    local procedure MarkSent(EntryNo: Integer)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(EntryNo);
        Entry.Sent := true;
        Entry.Modify();
    end;

    local procedure HX60MarkAttempted(EntryNo: Integer)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(EntryNo);
        Entry.Attempts := 2;
        Entry."Last Attempt At" := CreateDateTime(20270228D, 103000T);
        Entry."Last Error" := 'HX060 endpoint timed out';
        Entry.Modify();
    end;

    local procedure MarkFailed(EntryNo: Integer)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(EntryNo);
        Entry.Failed := true;
        Entry.Attempts := 3;
        Entry.Modify();
    end;
}
