codeunit 80076 "CGR Outbox Retry Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DeliveredEntryIsSent()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-ORN-001');
        EntryNo := Lib.QueueOutboxEntry('T-ORN-001');
        BindSubscription(Subscribers);

        Entry.SetRange("Vehicle No.", 'T-ORN-001');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'One entry delivered');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'Delivered entry is sent');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.AreEqual('', Entry."Last Error", 'No error');
    end;

    [Test]
    procedure RejectedEntryKeepsItsError()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        DeliveredNo: Integer;
        RejectedNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-ORN-002');
        Lib.ClearOutbox('T-ORN-003');
        DeliveredNo := Lib.QueueOutboxEntry('T-ORN-002');
        RejectedNo := Lib.QueueOutboxEntry('T-ORN-003');
        Subscribers.RejectOutboxVehicle('T-ORN-003');
        BindSubscription(Subscribers);

        Entry.SetFilter("Vehicle No.", '%1|%2', 'T-ORN-002', 'T-ORN-003');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'Only one entry delivered');
        Entry.Get(DeliveredNo);
        Assert.IsTrue(Entry.Sent, 'The accepted entry is sent');
        Entry.Get(RejectedNo);
        Assert.IsFalse(Entry.Sent, 'The rejected entry is not sent');
        Assert.IsFalse(Entry.Failed, 'One rejection is below the attempt limit');
        Assert.AreEqual(1, Entry.Attempts, 'One attempt');
        Assert.AreEqual('Endpoint rejected vehicle T-ORN-003.', Entry."Last Error", 'Rejection text kept');
    end;

    [Test]
    procedure EntryFailsAtMaxAttempts()
    var
        Entry: Record "CGR Outbox Entry";
        Subscribers: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 2);
        Lib.ClearOutbox('T-ORN-004');
        EntryNo := Lib.QueueOutboxEntry('T-ORN-004');
        Subscribers.RejectOutboxVehicle('T-ORN-004');
        BindSubscription(Subscribers);
        Entry.SetRange("Vehicle No.", 'T-ORN-004');

        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'First attempt rejected');
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Not failed after the first attempt');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'Second attempt rejected');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the attempt limit');
        Assert.AreEqual(2, Entry.Attempts, 'Two attempts');
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'A failed entry is not dispatched');
        Entry.Get(EntryNo);
        Assert.AreEqual(2, Entry.Attempts, 'No attempt on a failed entry');

        Dispatcher.Requeue(EntryNo);
        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Requeue clears the failure');
        Assert.AreEqual(0, Entry.Attempts, 'Requeue resets the attempts');
    end;

    [Test]
    procedure UndeliveredWithoutTransport()
    var
        Entry: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-ORN-005');
        EntryNo := Lib.QueueOutboxEntry('T-ORN-005');

        Assert.IsFalse(Dispatcher.DispatchEntry(EntryNo), 'Nothing delivers the entry');
        Entry.Get(EntryNo);
        Assert.AreEqual(1, Entry.Attempts, 'The attempt is counted');
        Assert.AreEqual(StrSubstNo('Outbox entry %1 was not delivered.', EntryNo), Entry."Last Error", 'Not-delivered text');
    end;

    [Test]
    procedure RetryAfterRejectionClearsError()
    var
        Entry: Record "CGR Outbox Entry";
        Rejecter: Codeunit "CGR Test Library";
        Deliverer: Codeunit "CGR Test Library";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-ORN-006');
        EntryNo := Lib.QueueOutboxEntry('T-ORN-006');
        Entry.SetRange("Vehicle No.", 'T-ORN-006');

        Rejecter.RejectOutboxVehicle('T-ORN-006');
        BindSubscription(Rejecter);
        Assert.AreEqual(0, Dispatcher.DispatchPending(Entry), 'First attempt rejected');
        UnbindSubscription(Rejecter);

        BindSubscription(Deliverer);
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'Retry delivered');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'Retried entry is sent');
        Assert.AreEqual('', Entry."Last Error", 'Delivery clears the earlier error');
    end;
}
