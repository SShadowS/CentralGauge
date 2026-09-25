codeunit 85000 "HX001 Return Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        DamageTxt: Label 'Scratch on rear door', Locked = true;
        SecondDamageTxt: Label 'Dent', Locked = true;
        EarlierDamageTxt: Label 'Chipped windscreen', Locked = true;

    [Test]
    procedure DamagedReturnBlocksVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-A', 1000), 1450, DamageTxt);
        Vehicle.Get('HX001-A');
        Assert.IsTrue(Vehicle.Blocked, 'A damaged return blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'A damaged return counts one open damage');
    end;

    [Test]
    procedure DamagedReturnReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-B', 1000), 1450, DamageTxt);
        Vehicle.Get('HX001-B');
        Assert.IsFalse(Vehicle."Checked Out", 'A damaged return still releases the vehicle');
        Assert.AreEqual(1450, Vehicle.Mileage, 'A damaged return records the return mileage');
    end;

    [Test]
    procedure DamagedReturnRecordsDamage()
    var
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-C', 1000), 1450, DamageTxt);
        DamageEntry.SetRange("Vehicle No.", 'HX001-C');
        Assert.AreEqual(1, DamageEntry.Count(), 'A damaged return creates exactly one damage entry');
        DamageEntry.FindFirst();
        Assert.AreEqual(DamageTxt, DamageEntry.Description, 'Damage entry description');
        Assert.IsFalse(DamageEntry.Repaired, 'The new damage entry is open');
    end;

    [Test]
    procedure DamagedReturnCompletesContract()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := CheckedOutContract('HX001-D', 1000);
        RentalMgt.Return(ContractNo, 1450, DamageTxt);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A damaged return completes the contract');
        Assert.AreEqual(1450, Contract."Return Km", 'Contract return km');
        Assert.AreEqual(DamageTxt, Contract."Damage Description", 'Contract damage description');
    end;

    [Test]
    procedure DamagedVehicleCannotBeRentedAgain()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        NextContractNo: Code[20];
    begin
        RentalMgt.Return(CheckedOutContract('HX001-E', 1000), 1450, DamageTxt);
        NextContractNo := RentalMgt.CreateContract('HX001-E', 'Oracle Customer', 20270310D, 20270312D);
        asserterror RentalMgt.CheckOut(NextContractNo);
        Assert.ExpectedError('Vehicle HX001-E is not available.');
    end;

    [Test]
    procedure RepairAfterDamagedReturnReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-F', 1000), 1450, DamageTxt);
        DamageMgt.RepairDamage(FirstDamageEntryNo('HX001-F'));
        Vehicle.Get('HX001-F');
        Assert.IsFalse(Vehicle.Blocked, 'Repairing the only damage unblocks the vehicle');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage after the repair');
        Assert.IsTrue(FleetMgt.IsAvailable('HX001-F'), 'The repaired vehicle is available again');
        Assert.AreEqual(1450, Vehicle.Mileage, 'Mileage from the damaged return is kept');
    end;

    [Test]
    procedure SecondDamagedReturnAfterRepair()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        DamageMgt: Codeunit "CGR Damage Mgt";
        NextContractNo: Code[20];
    begin
        RentalMgt.Return(CheckedOutContract('HX001-G', 1000), 1450, DamageTxt);
        DamageMgt.RepairDamage(FirstDamageEntryNo('HX001-G'));
        NextContractNo := RentalMgt.CreateContract('HX001-G', 'Oracle Customer', 20270310D, 20270312D);
        RentalMgt.CheckOut(NextContractNo);
        RentalMgt.Return(NextContractNo, 1900, SecondDamageTxt);

        Vehicle.Get('HX001-G');
        Assert.IsTrue(Vehicle.Blocked, 'The second damaged return blocks the vehicle again');
        Assert.AreEqual(1, Vehicle."Open Damages", 'Only the new damage is open');
        Assert.AreEqual(1900, Vehicle.Mileage, 'Mileage from the second return');
        DamageEntry.SetRange("Vehicle No.", 'HX001-G');
        Assert.AreEqual(2, DamageEntry.Count(), 'Both returns recorded a damage entry');
        DamageEntry.SetRange(Repaired, false);
        Assert.AreEqual(1, DamageEntry.Count(), 'One damage entry is open');
        DamageEntry.FindFirst();
        Assert.AreEqual(SecondDamageTxt, DamageEntry.Description, 'The open damage is the one from the second return');
    end;

    [Test]
    procedure MultipleOpenDamagesOnReturn()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
        ContractNo: Code[20];
    begin
        ContractNo := CheckedOutContract('HX001-I', 1000);
        DamageMgt.RegisterDamage('HX001-I', EarlierDamageTxt);
        RentalMgt.Return(ContractNo, 1450, DamageTxt);

        DamageEntry.SetRange("Vehicle No.", 'HX001-I');
        DamageEntry.SetRange(Repaired, false);
        Assert.AreEqual(2, DamageEntry.Count(), 'Two open damage entries');
        Vehicle.Get('HX001-I');
        Assert.AreEqual(2, Vehicle."Open Damages", 'Both damages are counted as open');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle is blocked');
        Assert.IsFalse(Vehicle."Checked Out", 'The vehicle is released');
        Assert.AreEqual(1450, Vehicle.Mileage, 'Mileage from the return');

        DamageEntry.FindSet();
        FirstEntryNo := DamageEntry."Entry No.";
        DamageEntry.Next();
        SecondEntryNo := DamageEntry."Entry No.";

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('HX001-I');
        Assert.IsTrue(Vehicle.Blocked, 'Still blocked while one damage is open');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage after the first repair');

        DamageMgt.RepairDamage(SecondEntryNo);
        Vehicle.Get('HX001-I');
        Assert.IsFalse(Vehicle.Blocked, 'Unblocked after the last repair');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage after the last repair');
        Assert.IsTrue(FleetMgt.IsAvailable('HX001-I'), 'Available after the last repair');
    end;

    [Test]
    procedure ReturnWithoutDamageLeavesVehicleUnblocked()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Return(CheckedOutContract('HX001-H', 1000), 1200, '');
        Vehicle.Get('HX001-H');
        Assert.IsFalse(Vehicle.Blocked, 'A return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'A return without damage leaves no open damage');
        Assert.IsFalse(Vehicle."Checked Out", 'The vehicle is released');
        Assert.AreEqual(1200, Vehicle.Mileage, 'Mileage from the return');
        DamageEntry.SetRange("Vehicle No.", 'HX001-H');
        Assert.IsTrue(DamageEntry.IsEmpty(), 'A return without damage creates no damage entry');
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]; Mileage: Integer): Code[20]
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Blocked := false;
        Vehicle."Open Damages" := 0;
        Vehicle."Checked Out" := false;
        Vehicle.Insert();
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'Oracle Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        exit(ContractNo);
    end;

    local procedure FirstDamageEntryNo(VehicleNo: Code[20]): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.FindFirst();
        exit(DamageEntry."Entry No.");
    end;
}
