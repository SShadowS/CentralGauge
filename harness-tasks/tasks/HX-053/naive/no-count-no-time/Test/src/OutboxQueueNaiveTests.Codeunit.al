codeunit 80108 "CGR Outbox Queue Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PayloadCarriesVehicleNo()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"T-OQN-001"}',
            Facade.VehicleCheckedOutPayload('T-OQN-001'), 'Payload shape');
    end;

    [Test]
    procedure OutboxQueuesCheckout()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Payload: JsonObject;
        Token: JsonToken;
    begin
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-OQN-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Entry.SetRange("Vehicle No.", 'T-OQN-002');
        Entry.DeleteAll();
        RentalMgt.CheckOut(Lib.CreateContract('T-OQN-002'));
        Assert.IsTrue(Entry.FindLast(), 'A checkout queues an outbox entry for the vehicle');
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'Outbox event type');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
        Assert.IsTrue(Payload.Get('vehicleNo', Token), 'The payload names the vehicle');
        Assert.AreEqual('T-OQN-002', Token.AsValue().AsText(), 'Payload vehicle number');
    end;

    [Test]
    procedure PurgeRemovesSentEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Deliverer: Codeunit "CGR Test Library";
        Facade: Codeunit "CGR Integration Facade";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OQN-003');
        EntryNo := Lib.QueueOutboxEntry('T-OQN-003');
        BindSubscription(Deliverer);
        Entry.SetRange("Vehicle No.", 'T-OQN-003');
        Assert.AreEqual(1, Dispatcher.DispatchPending(Entry), 'The entry is delivered');
        UnbindSubscription(Deliverer);

        Facade.PurgeSent();

        Assert.IsFalse(Entry.Get(EntryNo), 'The sent entry is purged');
    end;

    [Test]
    procedure PurgeKeepsAttemptedUnsentEntry()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        EntryNo: Integer;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearOutbox('T-OQN-004');
        EntryNo := Lib.QueueOutboxEntry('T-OQN-004');
        Assert.IsFalse(Dispatcher.DispatchEntry(EntryNo), 'Nothing delivers the entry');

        Facade.PurgeSent();

        Assert.IsTrue(Entry.Get(EntryNo), 'The unsent entry is kept');
    end;

    [Test]
    procedure MarkSentUnknownEntryFails()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        UnknownNo: Integer;
    begin
        if Entry.FindLast() then
            UnknownNo := Entry."Entry No." + 1
        else
            UnknownNo := 1;

        asserterror Facade.MarkSent(UnknownNo);
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
        Lib.ClearOutbox('T-OQN-005');
        EntryNo := Lib.QueueOutboxEntry('T-OQN-005');
        Dispatcher.DispatchEntry(EntryNo);

        Dispatcher.Requeue(EntryNo);

        Entry.Get(EntryNo);
        Assert.IsFalse(Entry.Failed, 'Requeue clears the failure');
        Assert.AreEqual('', Entry."Last Error", 'Requeue clears the error');
    end;
}
