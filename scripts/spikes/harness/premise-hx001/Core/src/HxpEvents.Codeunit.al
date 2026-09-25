// SPIKE (throwaway): harness bench M4-00 premise probe
codeunit 50101 "HXP Events"
{
    procedure RaiseOtherApp(VehicleNo: Code[20])
    begin
        OnDamageOtherApp(VehicleNo);
    end;

    procedure RaiseSameApp(VehicleNo: Code[20])
    begin
        OnDamageSameApp(VehicleNo);
    end;

    procedure RaiseByVar(var Vehicle: Record "HXP Vehicle")
    begin
        OnDamageByVar(Vehicle);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnDamageOtherApp(VehicleNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnDamageSameApp(VehicleNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnDamageByVar(var Vehicle: Record "HXP Vehicle")
    begin
    end;
}
