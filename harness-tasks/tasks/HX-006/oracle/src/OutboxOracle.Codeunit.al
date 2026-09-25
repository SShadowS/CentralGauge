codeunit 85500 "HX006 Outbox Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        DamageTxt: Label 'Bule på "dør"', Locked = true;

    [Test]
    procedure ReturnQueuesMessageWithNumbers()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        MakeVehicle('HX6-A');
        RentalMgt.Return(CheckedOut('HX6-A'), 1450, '');
        AssertSequence('HX6-A', 1, 2);
        LastEntry('HX6-A', Entry);
        Assert.AreEqual('vehicleReturned', Entry."Event Type", 'Return event type');
        Assert.AreEqual('{"event":"vehicleReturned","vehicleNo":"HX6-A","returnKm":1450,"damage":false,"sequence":2}',
            Entry.Payload, 'Compact return payload in key order, numbers and booleans unquoted, no damage description');
    end;

    [Test]
    procedure DamagedReturnCarriesDescription()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Payload: JsonObject;
        Token: JsonToken;
        Prefix: Text;
        Suffix: Text;
    begin
        MakeVehicle('HX6-B');
        RentalMgt.Return(CheckedOut('HX6-B'), 1300, DamageTxt);
        LastEntry('HX6-B', Entry);
        Prefix := '{"event":"vehicleReturned","vehicleNo":"HX6-B","returnKm":1300,"damage":true,"damageDescription":"';
        Suffix := '","sequence":2}';
        Assert.AreEqual(Prefix, CopyStr(Entry.Payload, 1, StrLen(Prefix)), 'Damaged return payload starts in key order');
        Assert.AreEqual(Suffix, CopyStr(Entry.Payload, StrLen(Entry.Payload) - StrLen(Suffix) + 1), 'Damaged return payload ends with the sequence');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
        Assert.IsTrue(Payload.Get('damageDescription', Token), 'The payload carries the damage description');
        Assert.AreEqual(DamageTxt, Token.AsValue().AsText(), 'The damage description round-trips');
    end;

    [Test]
    procedure CheckoutPayloadCarriesSequence()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        MakeVehicle('HX6-C');
        CheckedOut('HX6-C');
        LastEntry('HX6-C', Entry);
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"HX6-C","sequence":1}', Entry.Payload, 'Compact checkout payload with the sequence');
        Assert.AreEqual(1, Entry."Vehicle Sequence No.", 'The first message of a vehicle is number 1');
    end;

    [Test]
    procedure SequenceIsPerVehicle()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractD: Code[20];
        ContractE: Code[20];
    begin
        MakeVehicle('HX6-D');
        MakeVehicle('HX6-E');
        ContractD := CheckedOut('HX6-D');
        ContractE := CheckedOut('HX6-E');
        RentalMgt.Return(ContractD, 1100, '');
        CheckedOut('HX6-D');
        RentalMgt.Return(ContractE, 1200, '');
        AssertSequence('HX6-D', 1, 3);
        AssertSequence('HX6-E', 1, 2);
    end;

    [Test]
    procedure SequenceContinuesAfterPurge()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Facade: Codeunit "CGR Integration Facade";
    begin
        MakeVehicle('HX6-F');
        RentalMgt.Return(CheckedOut('HX6-F'), 1100, '');
        Entry.SetRange("Vehicle No.", 'HX6-F');
        Entry.FindSet();
        repeat
            Facade.MarkSent(Entry."Entry No.");
        until Entry.Next() = 0;
        Facade.PurgeSent();
        CheckedOut('HX6-F');
        AssertSequence('HX6-F', 3, 1);
    end;

    local procedure MakeVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;

    local procedure CheckedOut(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Oracle Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;

    local procedure LastEntry(VehicleNo: Code[20]; var Entry: Record "CGR Outbox Entry")
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Assert.IsTrue(Entry.FindLast(), 'The vehicle has an outbox entry');
    end;

    /// Every outbox entry of the vehicle, in entry order, carries the next number
    /// from First on, in the field and in the payload's "sequence".
    local procedure AssertSequence(VehicleNo: Code[20]; First: Integer; ExpectedCount: Integer)
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        Token: JsonToken;
        Expected: Integer;
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        Assert.AreEqual(ExpectedCount, Entry.Count(), StrSubstNo('Number of outbox entries for %1', VehicleNo));
        Expected := First;
        Entry.FindSet();
        repeat
            Assert.AreEqual(Expected, Entry."Vehicle Sequence No.", StrSubstNo('Vehicle Sequence No. of entry %1 of %2', Expected - First + 1, VehicleNo));
            Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
            Assert.IsTrue(Payload.Get('sequence', Token), 'The payload carries the sequence');
            Assert.AreEqual(Expected, Token.AsValue().AsInteger(), StrSubstNo('Payload sequence of entry %1 of %2', Expected - First + 1, VehicleNo));
            Expected += 1;
        until Entry.Next() = 0;
    end;
}
