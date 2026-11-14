codeunit 88660 "HX180 Contract Feed Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure CancelBookingQueuesOutboxEntry()
    var
        Contract: Record "CGR Rental Contract";
        Housekeeping: Codeunit "CGR Contract Housekeeping";
    begin
        InitHX180();
        SeedHX180Contract('HX180-C1', 'HX180-V1', Enum::"CGR Rental Status"::Open, 20270320D);
        SeedHX180Contract('HX180-C2', 'HX180-V1', Enum::"CGR Rental Status"::Open, 20270410D);

        Housekeeping.CancelBooking('HX180-C1');

        Assert.IsFalse(Contract.Get('HX180-C1'), 'The cancelled booking is deleted');
        Assert.IsTrue(Contract.Get('HX180-C2'), 'The other booking stays');
        Assert.AreEqual(1, HX180OutboxCount('HX180-V1'), 'One outbox entry per deleted contract');
        AssertHX180Deleted('HX180-V1', 'HX180-C1');
    end;

    [Test]
    procedure OtherAppDeleteIsSent()
    var
        Contract: Record "CGR Rental Contract";
    begin
        InitHX180();
        SeedHX180Contract('HX180-C3', 'HX180-V2', Enum::"CGR Rental Status"::Posted, 20251130D);

        Contract.Get('HX180-C3');
        Contract.Delete(true);

        Assert.AreEqual(1, HX180OutboxCount('HX180-V2'), 'A contract deleted by another app is sent once');
        AssertHX180Deleted('HX180-V2', 'HX180-C3');
    end;

    [Test]
    procedure PurgeLeavesOutboxUnchanged()
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
        Housekeeping: Codeunit "CGR Contract Housekeeping";
    begin
        InitHX180();
        SeedHX180Contract('HX180-C4', 'HX180-V3', Enum::"CGR Rental Status"::Posted, 20251031D);
        SeedHX180Contract('HX180-C5', 'HX180-V3', Enum::"CGR Rental Status"::Posted, 20251130D);
        SeedHX180Contract('HX180-C6', 'HX180-V3', Enum::"CGR Rental Status"::Posted, 20260115D);
        SeedHX180Contract('HX180-C7', 'HX180-V3', Enum::"CGR Rental Status"::Posted, 20270131D);
        SeedHX180Contract('HX180-C8', 'HX180-V3', Enum::"CGR Rental Status"::Open, 20251130D);
        Entry.Init();
        Entry."Event Type" := 'vehicleCheckedOut';
        Entry."Vehicle No." := 'HX180-V3';
        Entry.Payload := '{"event":"vehicleCheckedOut","vehicleNo":"HX180-V3"}';
        Entry.Insert();

        Housekeeping.PurgePostedContracts();

        Assert.IsFalse(Contract.Get('HX180-C4'), 'An old posted contract is purged');
        Assert.IsFalse(Contract.Get('HX180-C5'), 'An old posted contract is purged');
        Assert.IsFalse(Contract.Get('HX180-C6'), 'An old posted contract is purged');
        Assert.IsTrue(Contract.Get('HX180-C7'), 'A recent posted contract stays');
        Assert.IsTrue(Contract.Get('HX180-C8'), 'An open contract stays');
        Assert.AreEqual(1, HX180OutboxCount('HX180-V3'), 'The purge leaves the outbox as it was');
        Entry.Reset();
        Entry.SetRange("Vehicle No.", 'HX180-V3');
        Entry.FindFirst();
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'The earlier outbox entry is unchanged');
    end;

    [Test]
    procedure PurgeThenCancelSendsOnlyCancel()
    var
        Contract: Record "CGR Rental Contract";
        Housekeeping: Codeunit "CGR Contract Housekeeping";
    begin
        InitHX180();
        SeedHX180Contract('HX180-C9', 'HX180-V4', Enum::"CGR Rental Status"::Posted, 20250930D);
        SeedHX180Contract('HX180-CA', 'HX180-V4', Enum::"CGR Rental Status"::Posted, 20251231D);
        SeedHX180Contract('HX180-CB', 'HX180-V4', Enum::"CGR Rental Status"::Open, 20270315D);

        Housekeeping.PurgePostedContracts();
        Housekeeping.CancelBooking('HX180-CB');

        Assert.IsFalse(Contract.Get('HX180-C9'), 'An old posted contract is purged');
        Assert.IsFalse(Contract.Get('HX180-CA'), 'An old posted contract is purged');
        Assert.IsFalse(Contract.Get('HX180-CB'), 'The cancelled booking is deleted');
        Assert.AreEqual(1, HX180OutboxCount('HX180-V4'), 'Only the cancelled booking is sent');
        AssertHX180Deleted('HX180-V4', 'HX180-CB');
    end;

    local procedure InitHX180()
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20270301D);
        Contract.SetFilter("No.", 'HX180-*');
        Contract.DeleteAll();
        Entry.SetFilter("Vehicle No.", 'HX180-*');
        Entry.DeleteAll();
    end;

    local procedure SeedHX180Contract(ContractNo: Code[20]; VehicleNo: Code[20]; Status: Enum "CGR Rental Status"; EndDate: Date)
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX180 Customer';
        Contract."Start Date" := CalcDate('<-7D>', EndDate);
        Contract."End Date" := EndDate;
        Contract.Status := Status;
        Contract.Insert();
    end;

    local procedure HX180OutboxCount(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        exit(Entry.Count());
    end;

    local procedure AssertHX180Deleted(VehicleNo: Code[20]; ContractNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        Token: JsonToken;
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Assert.IsTrue(Entry.FindFirst(), 'An outbox entry is queued for the vehicle');
        Assert.AreEqual('contractDeleted', Entry."Event Type", 'Outbox event type');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
        Assert.IsTrue(Payload.Get('event', Token), 'The payload names the event');
        Assert.AreEqual('contractDeleted', Token.AsValue().AsText(), 'Payload event');
        Assert.IsTrue(Payload.Get('contractNo', Token), 'The payload names the contract');
        Assert.AreEqual(ContractNo, Token.AsValue().AsText(), 'Payload contract number');
        Assert.IsTrue(Payload.Get('vehicleNo', Token), 'The payload names the vehicle');
        Assert.AreEqual(VehicleNo, Token.AsValue().AsText(), 'Payload vehicle number');
    end;
}
