codeunit 70119 "CGR Insurer Check"
{
    var
        DamageVehicleNo: Code[20];
        DamageDescription: Text[100];

    trigger OnRun()
    begin
        CheckDamage(DamageVehicleNo, DamageDescription);
    end;

    procedure SetDamage(VehicleNo: Code[20]; Description: Text[100])
    begin
        DamageVehicleNo := VehicleNo;
        DamageDescription := Description;
    end;

    procedure CheckDamage(VehicleNo: Code[20]; Description: Text[100])
    begin
        OnCheckInsuredDamage(VehicleNo, Description);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnCheckInsuredDamage(VehicleNo: Code[20]; Description: Text[100])
    begin
    end;
}
