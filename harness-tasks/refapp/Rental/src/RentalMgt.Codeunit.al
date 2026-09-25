codeunit 70200 "CGR Rental Mgt"
{
    var
        NotAvailableErr: Label 'Vehicle %1 is not available.', Comment = '%1 = vehicle number';

    procedure CheckOut(VehicleNo: Code[20])
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
        CoreEvents: Codeunit "CGR Core Events";
    begin
        if not FleetMgt.IsAvailable(VehicleNo) then
            Error(NotAvailableErr, VehicleNo);
        CoreEvents.RaiseVehicleCheckedOut(VehicleNo);
    end;
}
