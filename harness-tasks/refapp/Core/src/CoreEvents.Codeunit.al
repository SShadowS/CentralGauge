codeunit 70000 "CGR Core Events"
{
    procedure RaiseVehicleCheckedOut(VehicleNo: Code[20])
    begin
        OnAfterVehicleCheckedOut(VehicleNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleCheckedOut(VehicleNo: Code[20])
    begin
    end;
}
