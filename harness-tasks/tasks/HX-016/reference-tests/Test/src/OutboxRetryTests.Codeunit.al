codeunit 80070 "CGR Outbox Retry Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DeliveryMarksEntrySent()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OR-001');
        EntryNo := Lib.QueueOutboxEntry('T-OR-001');
        BindSubscription(Deliverer);

        Entry.SetRange("Vehicle No.", 'T-OR-001');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One entry delivered');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'Delivered entry is sent');
        Assert.IsFalse(Entry.Failed, 'Delivered entry is not failed');
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual('', Entry."Last Error", 'Delivered entry has no error');
        Assert.AreNotEqual(0DT, Entry."Last Attempt At", 'The attempt time is recorded');
    end;

    [Test]
    procedure DeliveryAfterRejectionClearsError()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OR-002');
        EntryNo := Lib.QueueOutboxEntry('T-OR-002');
        Entry.SetRange("Vehicle No.", 'T-OR-002');

        Rejecter.RejectOutboxVehicle('T-OR-002');
        BindSubscription(Rejecter);
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'First attempt rejected');
        Entry.Get(EntryNo);
        Assert.AreEqual('Endpoint rejected vehicle T-OR-002.', Entry."Last Error", 'Rejection text kept');
        UnbindSubscription(Rejecter);

        BindSubscription(Deliverer);
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'Retry delivered');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'Retried entry is sent');
        Assert.AreEqual(2, Entry.Attempts, 'Both attempts counted');
        Assert.AreEqual('', Entry."Last Error", 'Delivery clears the earlier error');
    end;

    [Test]
    procedure LatestErrorTextIsKept()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OR-003');
        EntryNo := Lib.QueueOutboxEntry('T-OR-003');

        Assert.IsFalse(Dispatcher.DispatchEntry(EntryNo), 'Nothing delivers the entry');
        Entry.Get(EntryNo);
        Assert.AreEqual(StrSubstNo('Outbox entry %1 was not delivered.', EntryNo), Entry."Last Error", 'Not-delivered text');

        Rejecter.RejectOutboxVehicle('T-OR-003');
        BindSubscription(Rejecter);
        Entry.SetRange("Vehicle No.", 'T-OR-003');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'Second attempt rejected');
        Entry.Get(EntryNo);
        Assert.AreEqual('Endpoint rejected vehicle T-OR-003.', Entry."Last Error", 'The latest error replaces the earlier one');
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts');
        Assert.IsFalse(Entry.Failed, 'Two attempts stay below the limit of three');
    end;

    [Test]
    procedure SentEntryIsNotRedispatched()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OR-004');
        EntryNo := Lib.QueueOutboxEntry('T-OR-004');
        BindSubscription(Deliverer);
        Entry.SetRange("Vehicle No.", 'T-OR-004');

        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'First dispatch delivers');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'A sent entry is not dispatched again');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'No attempt on a sent entry');
        Assert.IsTrue(Entry.Sent, 'Entry stays sent');
    end;

    [Test]
    procedure FailsWhenAttemptsReachSetupMax()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 2);
        Lib.ClearOutbox('T-OR-005');
        EntryNo := Lib.QueueOutboxEntry('T-OR-005');
        Rejecter.RejectOutboxVehicle('T-OR-005');
        BindSubscription(Rejecter);
        Entry.SetRange("Vehicle No.", 'T-OR-005');

        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'First attempt rejected');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'One attempt is below the limit of two');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'Second attempt rejected');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed when the attempts reach the limit');
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'A failed entry is not dispatched');
        Entry.Get(EntryNo);
        Assert.AreEqual(2, Entry.Attempts, 'No attempt on a failed entry');
    end;

    [Test]
    procedure ZeroSetupAllowsThreeAttempts()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 0);
        Lib.ClearOutbox('T-OR-006');
        EntryNo := Lib.QueueOutboxEntry('T-OR-006');
        Rejecter.RejectOutboxVehicle('T-OR-006');
        BindSubscription(Rejecter);
        Entry.SetRange("Vehicle No.", 'T-OR-006');

        Dispatcher.DispatchPending(Entry);
        Dispatcher.DispatchPending(Entry);
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Two attempts stay below the default limit of three');
        Dispatcher.DispatchPending(Entry);
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the third attempt');
        Assert.AreEqual(3, Entry.Attempts, 'Three attempts');
    end;

    [Test]
    procedure MaxAttemptsFollowsSetup()
    var
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', -1);
        Assert.AreEqual(3, Dispatcher.MaxAttempts(), 'A negative Setup value falls back to three');
        Lib.SetV2Setup(0.01, '', 0);
        Assert.AreEqual(3, Dispatcher.MaxAttempts(), 'Zero falls back to three');
        Lib.SetV2Setup(0.01, '', 1);
        Assert.AreEqual(1, Dispatcher.MaxAttempts(), 'A positive Setup value is used');
        Lib.SetV2Setup(0.01, '', 4);
        Assert.AreEqual(4, Dispatcher.MaxAttempts(), 'A value above the default is used');
    end;

    [Test]
    procedure RequeueResetsFailedEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 1);
        Lib.ClearOutbox('T-OR-008');
        EntryNo := Lib.QueueOutboxEntry('T-OR-008');
        Rejecter.RejectOutboxVehicle('T-OR-008');
        BindSubscription(Rejecter);
        Entry.SetRange("Vehicle No.", 'T-OR-008');

        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'Attempt rejected');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the limit of one');

        Dispatcher.Requeue(EntryNo);
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Requeue clears the failure');
        Assert.AreEqual(0, Entry.Attempts, 'Requeue resets the attempts');
        Assert.AreEqual('', Entry."Last Error", 'Requeue clears the error');

        UnbindSubscription(Rejecter);
        BindSubscription(Deliverer);
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'A requeued entry is pending again');
    end;

    [Test]
    procedure DispatchHonoursEntryFilter()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        InsideNo: Integer;
        OutsideNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OR-009');
        Lib.ClearOutbox('T-OR-010');
        InsideNo := Lib.QueueOutboxEntry('T-OR-009');
        OutsideNo := Lib.QueueOutboxEntry('T-OR-010');
        BindSubscription(Deliverer);

        Entry.SetRange("Vehicle No.", 'T-OR-009');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'Only the filtered entry is dispatched');
        Entry.Get(InsideNo);
        Assert.IsTrue(Entry.Sent, 'Filtered entry is sent');
        Entry.Get(OutsideNo);
        Assert.IsFalse(Entry.Sent, 'Entry outside the filter is not sent');
        Assert.AreEqual(0, Entry.Attempts, 'Entry outside the filter has no attempt');
    end;
}
