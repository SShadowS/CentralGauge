codeunit 86882 "HX071 Register Runner"
{
    var
        DamageVehicleNo: Code[20];
        DamageDescription: Text[100];
        FailAfterwards: Boolean;
        RegisteredEntryNo: Integer;
        LaterStepErr: Label 'HX071 later step failed.';

    procedure SetHX071Damage(VehicleNo: Code[20]; Description: Text[100]; FailAfterRegistering: Boolean)
    begin
        DamageVehicleNo := VehicleNo;
        DamageDescription := Description;
        FailAfterwards := FailAfterRegistering;
    end;

    procedure HX071EntryNo(): Integer
    begin
        exit(RegisteredEntryNo);
    end;

    trigger OnRun()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        RegisteredEntryNo := DamageMgt.RegisterInsuredDamage(DamageVehicleNo, DamageDescription);
        if FailAfterwards then
            Error(LaterStepErr);
    end;
}
