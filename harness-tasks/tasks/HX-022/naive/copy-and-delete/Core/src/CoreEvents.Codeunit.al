codeunit 70000 "CGR Core Events"
{
    procedure RaiseVehicleCheckedOut(VehicleNo: Code[20])
    begin
        OnAfterVehicleCheckedOut(VehicleNo);
    end;

    procedure RaiseVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
        OnAfterVehicleReturned(VehicleNo, ReturnKm, DamageDescription);
    end;

    procedure RaiseVehicleNoChanged(OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    begin
        OnAfterVehicleNoChanged(OldVehicleNo, NewVehicleNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleCheckedOut(VehicleNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterVehicleNoChanged(OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    begin
    end;
}
