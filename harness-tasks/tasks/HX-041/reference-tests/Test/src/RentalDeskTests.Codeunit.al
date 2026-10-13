codeunit 80083 "CGR Rental Desk Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NotAvailableTxt: Label 'Vehicle %1 is not available.', Locked = true;
        WrongStatusTxt: Label 'Rental contract %1 must have status %2.', Locked = true;
        ReturnKmTxt: Label 'Return km %1 is below the start km %2.', Locked = true;

    [Test]
    procedure SwapMovesRunningRentalToFreeVehicle()
    var
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V01', 1000);
        Lib.CreateVehicle('HX041-V02', 2500, Enum::"CGR Maintenance Strategy"::Default);

        RentalMgt.SwapVehicle(ContractNo, 'HX041-V02');

        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-V02', Contract."Vehicle No.", 'The contract moves to the new vehicle');
        Assert.AreEqual(2500, Contract."Start Km", 'Start km is the new vehicle''s mileage');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract stays checked out');
        OldVehicle.Get('HX041-V01');
        Assert.IsFalse(OldVehicle."Checked Out", 'The old vehicle is released');
        NewVehicle.Get('HX041-V02');
        Assert.IsTrue(NewVehicle."Checked Out", 'The new vehicle is checked out');
    end;

    [Test]
    procedure SwapOntoDamagedVehicleIsRefused()
    var
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        DamageMgt: Codeunit "CGR Damage Mgt";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V03', 1000);
        Lib.CreateVehicle('HX041-V04', 3000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('HX041-V04', 'Dent in the tailgate');
        Commit();

        Runner.SetSwap(ContractNo, 'HX041-V04');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A vehicle with open damage cannot be swapped into a rental');
        Assert.AreEqual(StrSubstNo(NotAvailableTxt, 'HX041-V04'), GetLastErrorText(), 'Refusal text');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-V03', Contract."Vehicle No.", 'The contract keeps its vehicle');
        Assert.AreEqual(1000, Contract."Start Km", 'The contract keeps its start km');
        OldVehicle.Get('HX041-V03');
        Assert.IsTrue(OldVehicle."Checked Out", 'The old vehicle stays checked out');
        NewVehicle.Get('HX041-V04');
        Assert.IsFalse(NewVehicle."Checked Out", 'The damaged vehicle is not checked out');
    end;

    [Test]
    procedure SwapOntoCheckedOutVehicleIsRefused()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        OtherContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V05', 1000);
        OtherContractNo := CheckedOutContract('HX041-V06', 4000);
        Commit();

        Runner.SetSwap(ContractNo, 'HX041-V06');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A vehicle out on another rental cannot be swapped in');
        Assert.AreEqual(StrSubstNo(NotAvailableTxt, 'HX041-V06'), GetLastErrorText(), 'Refusal text');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-V05', Contract."Vehicle No.", 'The contract keeps its vehicle');
        Contract.Get(OtherContractNo);
        Assert.AreEqual('HX041-V06', Contract."Vehicle No.", 'The other contract keeps its vehicle');
    end;

    [Test]
    procedure SwapOfOpenContractIsRefused()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        Lib.CreateVehicle('HX041-V07', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX041-V08', 1500, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX041-V07');
        Commit();

        Runner.SetSwap(ContractNo, 'HX041-V08');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A contract that is not checked out cannot swap vehicles');
        Assert.AreEqual(StrSubstNo(WrongStatusTxt, ContractNo, Enum::"CGR Rental Status"::"Checked Out"), GetLastErrorText(), 'Refusal text');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-V07', Contract."Vehicle No.", 'The contract keeps its vehicle');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract stays open');
        Vehicle.Get('HX041-V08');
        Assert.IsFalse(Vehicle."Checked Out", 'The other vehicle is not checked out');
    end;

    [Test]
    procedure SwapOntoUnknownVehicleIsRefused()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V09', 1000);
        if Vehicle.Get('HX041-NOVEHICLE') then
            Vehicle.Delete();
        Commit();

        Runner.SetSwap(ContractNo, 'HX041-NOVEHICLE');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A swap to a vehicle number that does not exist fails');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-V09', Contract."Vehicle No.", 'The contract keeps its vehicle');
        Vehicle.Get('HX041-V09');
        Assert.IsTrue(Vehicle."Checked Out", 'The vehicle stays checked out');
    end;

    [Test]
    procedure ReturnAtStartKmIsAccepted()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V10', 1000);
        Commit();

        Runner.SetReturn(ContractNo, 1000, '');
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A return at exactly the start km is accepted: ' + GetLastErrorText());
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Assert.AreEqual(1000, Contract."Return Km", 'Return km');
        Vehicle.Get('HX041-V10');
        Assert.IsFalse(Vehicle."Checked Out", 'The vehicle is released');
        Assert.AreEqual(1000, Vehicle.Mileage, 'Mileage is the return km');
    end;

    [Test]
    procedure ReturnBelowSwappedStartKmIsRefused()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V11', 1000);
        Lib.CreateVehicle('HX041-V12', 2000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.SwapVehicle(ContractNo, 'HX041-V12');
        Commit();

        Runner.SetReturn(ContractNo, 1999, '');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A return below the start km of the swapped-in vehicle is refused');
        Assert.AreEqual(StrSubstNo(ReturnKmTxt, 1999, 2000), GetLastErrorText(), 'Refusal text');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract stays checked out');
        Assert.AreEqual(0, Contract."Return Km", 'No return km is stored');
    end;

    [Test]
    procedure ReturnOfOpenContractIsRefused()
    var
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Rental Desk Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        SetUpDesk();
        Lib.CreateVehicle('HX041-V13', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX041-V13');
        Commit();

        Runner.SetReturn(ContractNo, 1200, '');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A contract that is not checked out cannot be returned');
        Assert.AreEqual(StrSubstNo(WrongStatusTxt, ContractNo, Enum::"CGR Rental Status"::"Checked Out"), GetLastErrorText(), 'Refusal text');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract stays open');
    end;

    [Test]
    procedure ReturnWithDamageRegistersDamageInFleet()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V14', 1000);

        RentalMgt.Return(ContractNo, 1250, 'Cracked windscreen');

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Assert.AreEqual(1250, Contract."Return Km", 'Return km');
        Assert.AreEqual('Cracked windscreen', Contract."Damage Description", 'The contract keeps the damage description');
        Vehicle.Get('HX041-V14');
        Assert.IsFalse(Vehicle."Checked Out", 'The vehicle is released');
        Assert.AreEqual(1250, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsTrue(Vehicle.Blocked, 'A damaged return blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One more open damage');
        DamageEntry.SetRange("Vehicle No.", 'HX041-V14');
        Assert.AreEqual(1, DamageEntry.Count(), 'One damage entry is registered');
        DamageEntry.FindFirst();
        Assert.AreEqual('Cracked windscreen', DamageEntry.Description, 'Damage entry description');
        Assert.IsFalse(DamageEntry.Repaired, 'The damage is open');
    end;

    [Test]
    procedure ReturnWithoutDamageRegistersNothing()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        DamageEntry: Record "CGR Damage Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        SetUpDesk();
        ContractNo := CheckedOutContract('HX041-V15', 1000);

        RentalMgt.Return(ContractNo, 1100, '');

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract is returned');
        Assert.AreEqual('', Contract."Damage Description", 'No damage description');
        Vehicle.Get('HX041-V15');
        Assert.AreEqual(1100, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle.Blocked, 'A return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage');
        DamageEntry.SetRange("Vehicle No.", 'HX041-V15');
        Assert.AreEqual(0, DamageEntry.Count(), 'No damage entry is registered');
    end;

    local procedure SetUpDesk()
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]; Mileage: Integer) ContractNo: Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Lib.CreateVehicle(VehicleNo, Mileage, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract(VehicleNo);
        RentalMgt.CheckOut(ContractNo);
    end;
}
