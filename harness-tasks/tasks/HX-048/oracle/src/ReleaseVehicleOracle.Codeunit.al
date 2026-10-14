codeunit 86420 "HX048 Release Vehicle Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ReturnReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        RecRef: RecordRef;
        FldRef: FieldRef;
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-A');
        InsertCheckedOutContract('HX048-K-A', 'HX048-A');

        RentalMgt.Return('HX048-K-A', 1300, '');

        Vehicle.Get('HX048-A');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle is no longer checked out');
        Assert.AreEqual(1300, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle.Blocked, 'A return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'A return without damage adds no open damage');
        Assert.AreEqual(0, Vehicle."Last Damage Entry No.", 'A return without damage leaves Last Damage Entry No. 0');
        DamageEntry.SetRange("Vehicle No.", 'HX048-A');
        Assert.RecordIsEmpty(DamageEntry);
        RecRef.Open(Database::"CGR Vehicle");
        FldRef := RecRef.Field(12);
        Assert.AreEqual('Last Damage Entry No.', FldRef.Name, 'Field 12 of CGR Vehicle is Last Damage Entry No.');
        Assert.IsTrue(FldRef.Type = FieldType::Integer, 'Field 12 of CGR Vehicle is an Integer');
        RecRef.Close();
    end;

    [Test]
    procedure ReleaseVehicleDirectNoDamage()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-G');
        Vehicle.Get('HX048-G');
        Vehicle."Checked Out" := true;
        Vehicle."Last Damage Entry No." := 7;
        Vehicle.Modify();

        FleetMgt.ReleaseVehicle('HX048-G', 1500, '');

        Vehicle.Get('HX048-G');
        Assert.IsFalse(Vehicle."Checked Out", 'A released vehicle is no longer checked out');
        Assert.AreEqual(1500, Vehicle.Mileage, 'Mileage is the return km');
        Assert.AreEqual(0, Vehicle."Last Damage Entry No.", 'A release without damage sets Last Damage Entry No. to 0');
        Assert.IsFalse(Vehicle.Blocked, 'A release without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'A release without damage adds no open damage');
        DamageEntry.SetRange("Vehicle No.", 'HX048-G');
        Assert.RecordIsEmpty(DamageEntry);
    end;

    [Test]
    procedure DamagedReturnBlocksAndRemembers()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-B');
        InsertCheckedOutContract('HX048-K-B', 'HX048-B');

        RentalMgt.Return('HX048-K-B', 1200, 'Dent');

        DamageEntry.SetRange("Vehicle No.", 'HX048-B');
        Assert.AreEqual(1, DamageEntry.Count(), 'A damaged return registers one damage entry');
        DamageEntry.FindFirst();
        Assert.AreEqual('Dent', DamageEntry.Description, 'The damage entry carries the return damage');
        Vehicle.Get('HX048-B');
        Assert.IsTrue(Vehicle.Blocked, 'A damaged return blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'A damaged return adds one open damage');
        Assert.AreEqual(DamageEntry."Entry No.", Vehicle."Last Damage Entry No.", 'Last Damage Entry No. is the return damage entry');
        Assert.AreEqual(1200, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle is no longer checked out');
    end;

    [Test]
    procedure DamagedReturnOnDamagedVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-C');
        DamageEntry.Init();
        DamageEntry."Vehicle No." := 'HX048-C';
        DamageEntry.Description := 'Old dent';
        DamageEntry."Reported On" := 20270215D;
        DamageEntry.Insert();
        Vehicle.Get('HX048-C');
        Vehicle."Open Damages" := 1;
        Vehicle.Blocked := true;
        Vehicle.Modify();
        InsertCheckedOutContract('HX048-K-C', 'HX048-C');

        RentalMgt.Return('HX048-K-C', 1100, 'Scratch');

        Clear(DamageEntry);
        DamageEntry.SetRange("Vehicle No.", 'HX048-C');
        DamageEntry.SetRange(Description, 'Scratch');
        Assert.AreEqual(1, DamageEntry.Count(), 'The return registers its own damage entry');
        DamageEntry.FindFirst();
        Vehicle.Get('HX048-C');
        Assert.AreEqual(2, Vehicle."Open Damages", 'The return damage is one more open damage');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle stays blocked');
        Assert.AreEqual(DamageEntry."Entry No.", Vehicle."Last Damage Entry No.", 'Last Damage Entry No. is the new damage entry');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle is no longer checked out');
    end;

    [Test]
    procedure UndamagedReturnClearsLastDamage()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-D');
        Vehicle.Get('HX048-D');
        Vehicle."Last Damage Entry No." := 7;
        Vehicle.Modify();
        InsertCheckedOutContract('HX048-K-D', 'HX048-D');

        RentalMgt.Return('HX048-K-D', 1100, '');

        Vehicle.Get('HX048-D');
        Assert.AreEqual(0, Vehicle."Last Damage Entry No.", 'A return without damage sets Last Damage Entry No. to 0');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle is no longer checked out');
    end;

    [Test]
    procedure ReleaseVehicleDirect()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-E');
        Vehicle.Get('HX048-E');
        Vehicle."Checked Out" := true;
        Vehicle.Modify();

        FleetMgt.ReleaseVehicle('HX048-E', 1500, 'Dent');

        DamageEntry.SetRange("Vehicle No.", 'HX048-E');
        Assert.AreEqual(1, DamageEntry.Count(), 'ReleaseVehicle registers one damage entry');
        DamageEntry.FindFirst();
        Vehicle.Get('HX048-E');
        Assert.IsFalse(Vehicle."Checked Out", 'A released vehicle is no longer checked out');
        Assert.AreEqual(1500, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsTrue(Vehicle.Blocked, 'A release with damage blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'A release with damage adds one open damage');
        Assert.AreEqual(DamageEntry."Entry No.", Vehicle."Last Damage Entry No.", 'Last Damage Entry No. is the registered damage entry');
    end;

    [Test]
    procedure ReleaseUnknownVehicleDoesNothing()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Runner: Codeunit "HX048 Release Runner";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        InitSetup();
        DamageEntry.SetRange("Vehicle No.", 'HX048-NONE');
        DamageEntry.DeleteAll();
        if Vehicle.Get('HX048-NONE') then
            Vehicle.Delete();

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'ReleaseVehicle for a number that is no vehicle raises no error: ' + GetLastErrorText());
        Assert.RecordIsEmpty(DamageEntry);
        Assert.IsFalse(Vehicle.Get('HX048-NONE'), 'ReleaseVehicle for a number that is no vehicle creates no vehicle');
    end;

    [Test]
    procedure ReturnKeepsContractAsToday()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        InitVehicle('HX048-F');
        InsertCheckedOutContract('HX048-K-F', 'HX048-F');

        RentalMgt.Return('HX048-K-F', 1100, 'Dent');

        Contract.Get('HX048-K-F');
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Assert.AreEqual(1100, Contract."Return Km", 'The contract keeps the return km');
        Assert.AreEqual('Dent', Contract."Damage Description", 'The contract keeps the damage description');
        Vehicle.Get('HX048-F');
        Assert.IsFalse(Vehicle."Checked Out", 'A returned vehicle is no longer checked out');
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle.Insert();
    end;

    local procedure InsertCheckedOutContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX048 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Status := Contract.Status::"Checked Out";
        Contract."Start Km" := 1000;
        Contract.Insert();
        Vehicle.Get(VehicleNo);
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
    end;
}
