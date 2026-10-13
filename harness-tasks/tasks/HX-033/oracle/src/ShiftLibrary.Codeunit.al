// Arrangement helpers for the HX033 rows. Each row is its own test codeunit (its own SOAP run), so the
// single-instance shift starts empty in every row (P1); no row relies on ClearShift as a precondition.
codeunit 86129 "HX033 Shift Library"
{
    // Work date and Setup per procedure (rentals not suspended), then the session Setup cache is dropped.
    procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    procedure InitVehicle(VehicleNo: Code[20])
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
        Vehicle.Insert();
    end;

    // Inserts open contract ContractNo for VehicleNo, checks it out and returns it 100 km later through
    // "CGR Rental Mgt" with the given damage description.
    procedure RentAndReturn(ContractNo: Code[20]; VehicleNo: Code[20]; DamageDescription: Text[100])
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentOut(ContractNo, VehicleNo);
        Contract.Get(ContractNo);
        RentalMgt.Return(ContractNo, Contract."Start Km" + 100, DamageDescription);
    end;

    // Every row needs an empty shift; each row codeunit runs in its own SOAP session (P1).
    procedure AssertShiftStartsEmpty()
    var
        Shift: Codeunit "CGR Shift Returns";
        Assert: Codeunit "Library Assert";
        Returned: List of [Code[20]];
        Damaged: List of [Code[20]];
    begin
        Shift.ReturnedVehicles(Returned);
        Shift.DamagedVehicles(Damaged);
        Assert.AreEqual(0, Returned.Count(), 'Precondition: shift starts empty (one SOAP session per codeunit)');
        Assert.AreEqual(0, Damaged.Count(), 'Precondition: shift starts empty (one SOAP session per codeunit)');
    end;

    // Inserts open contract ContractNo for VehicleNo and checks it out (start km = the vehicle's mileage).
    procedure RentOut(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX033 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Status := Contract.Status::Open;
        Contract.Insert();
        RentalMgt.CheckOut(ContractNo);
    end;

    // Repairs every open damage of VehicleNo through the Fleet repair path, which unblocks the vehicle.
    procedure RepairOpenDamages(VehicleNo: Code[20])
    var
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNos: List of [Integer];
        EntryNo: Integer;
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.SetRange(Repaired, false);
        if DamageEntry.FindSet() then
            repeat
                EntryNos.Add(DamageEntry."Entry No.");
            until DamageEntry.Next() = 0;
        foreach EntryNo in EntryNos do
            DamageMgt.RepairDamage(EntryNo);
    end;

    procedure ListText(VehicleNos: List of [Code[20]]): Text
    var
        VehicleNo: Code[20];
        Result: Text;
    begin
        foreach VehicleNo in VehicleNos do
            Result += VehicleNo + '|';
        exit(Result);
    end;
}
