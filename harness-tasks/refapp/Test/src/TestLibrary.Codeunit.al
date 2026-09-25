codeunit 80090 "CGR Test Library"
{
    procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy")
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
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;

    procedure CreateContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'Test Customer', 20270301D, 20270303D));
    end;

    procedure CreateLease(VehicleNo: Code[20]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        exit(LeaseMgt.CreateContract(VehicleNo, 'Test Customer', StartDate, Months, BaseRate));
    end;
}
