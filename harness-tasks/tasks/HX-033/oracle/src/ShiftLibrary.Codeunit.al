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
        Contract.Get(ContractNo);
        RentalMgt.Return(ContractNo, Contract."Start Km" + 100, DamageDescription);
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
