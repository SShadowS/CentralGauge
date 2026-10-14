codeunit 80107 "CGR Outbox Queue Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure QueueAddsOneUnsentEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OQ-001');

        Facade.QueueVehicleCheckedOut('T-OQ-001');

        Entry.SetRange("Vehicle No.", 'T-OQ-001');
        Assert.AreEqual(1, Entry.Count(), 'One entry is queued');
        Entry.FindFirst();
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'Event type');
        Assert.AreEqual('T-OQ-001', Entry."Vehicle No.", 'Vehicle number');
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"T-OQ-001"}', Entry.Payload, 'Payload');
        Assert.AreNotEqual(0DT, Entry."Created At", 'Created At is set');
        Assert.AreEqual(0, Entry.Attempts, 'No attempts yet');
        Assert.IsFalse(Entry.Sent, 'A queued entry is not sent');
        Assert.IsFalse(Entry.Failed, 'A queued entry is not failed');
        Assert.AreEqual('', Entry."Last Error", 'A queued entry has no error');
    end;

    [Test]
    procedure CheckoutQueuesExactlyOneEntry()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-OQ-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.ClearOutbox('T-OQ-002');

        RentalMgt.CheckOut(Lib.CreateContract('T-OQ-002'));

        Entry.SetRange("Vehicle No.", 'T-OQ-002');
        Assert.AreEqual(1, Entry.Count(), 'A checkout queues exactly one entry');
        Entry.FindFirst();
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'Event type');
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"T-OQ-002"}', Entry.Payload, 'Payload');
        Assert.IsFalse(Entry.Sent, 'The queued entry is not sent');
    end;

    [Test]
    procedure ReturnQueuesNothing()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-OQ-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.ClearOutbox('T-OQ-003');
        ContractNo := Lib.CreateContract('T-OQ-003');
        Entry.SetRange("Vehicle No.", 'T-OQ-003');

        RentalMgt.CheckOut(ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'The checkout queues one entry');

        RentalMgt.Return(ContractNo, 1100, '');
        Assert.AreEqual(1, Entry.Count(), 'The return queues nothing');
    end;

    [Test]
    procedure MarkSentSetsSent()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OQ-004');
        EntryNo := Lib.QueueOutboxEntry('T-OQ-004');

        Facade.MarkSent(EntryNo);

        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Sent, 'The entry is sent');
        Assert.AreEqual(0, Entry.Attempts, 'Marking sent is not an attempt');
        Assert.IsFalse(Entry.Failed, 'The entry is not failed');
    end;

    [Test]
    procedure MarkSentUnknownEntryFails()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        UnknownNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        if Entry.FindLast() then
            UnknownNo := Entry."Entry No." + 1
        else
            UnknownNo := 1;

        asserterror Facade.MarkSent(UnknownNo);
    end;

    [Test]
    procedure PurgeSentKeepsUnsentEntries()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        SentNo: Integer;
        AttemptedNo: Integer;
        NewNo: Integer;
        FailedNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OQ-006');
        SentNo := Lib.QueueOutboxEntry('T-OQ-006');
        Facade.MarkSent(SentNo);
        AttemptedNo := Lib.QueueOutboxEntry('T-OQ-006');
        Assert.IsFalse(Dispatcher.DispatchEntry(AttemptedNo), 'Nothing delivers the entry');
        NewNo := Lib.QueueOutboxEntry('T-OQ-006');
        FailedNo := Lib.QueueOutboxEntry('T-OQ-006');
        Dispatcher.DispatchEntry(FailedNo);
        Dispatcher.DispatchEntry(FailedNo);
        Dispatcher.DispatchEntry(FailedNo);
        Entry.Get(FailedNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the limit of three');

        Facade.PurgeSent();

        Assert.IsFalse(Entry.Get(SentNo), 'The sent entry is purged');
        Assert.IsTrue(Entry.Get(AttemptedNo), 'The attempted unsent entry is kept');
        Assert.AreEqual(1, Entry.Attempts, 'The kept entry keeps its attempt');
        Assert.IsFalse(Entry.Sent, 'The kept entry is not sent');
        Assert.IsTrue(Entry.Get(NewNo), 'The never attempted entry is kept');
        Assert.IsTrue(Entry.Get(FailedNo), 'The failed unsent entry is kept');
        Assert.IsTrue(Entry.Failed, 'The kept failed entry stays failed');
    end;

    [Test]
    procedure RequeueClearsLastError()
    var
        Entry: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 1);
        Lib.ClearOutbox('T-OQ-007');
        EntryNo := Lib.QueueOutboxEntry('T-OQ-007');
        Assert.IsFalse(Dispatcher.DispatchEntry(EntryNo), 'Nothing delivers the entry');
        Entry.Get(EntryNo);
        Assert.IsTrue(Entry.Failed, 'Failed at the limit of one');
        Assert.AreNotEqual('', Entry."Last Error", 'The failed attempt left an error');

        Dispatcher.Requeue(EntryNo);

        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Requeue clears the failure');
        Assert.AreEqual(0, Entry.Attempts, 'Requeue resets the attempts');
        Assert.AreEqual('', Entry."Last Error", 'Requeue clears the error');
    end;
}
