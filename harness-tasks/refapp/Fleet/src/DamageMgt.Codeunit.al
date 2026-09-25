codeunit 70102 "CGR Damage Mgt"
{
    procedure RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := WorkDate();
        DamageEntry.Insert(true);
        OnAfterDamageRegistered(DamageEntry);
        exit(DamageEntry."Entry No.");
    end;

    procedure RepairDamage(EntryNo: Integer)
    var
        DamageEntry: Record "CGR Damage Entry";
        OpenDamage: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
    begin
        DamageEntry.Get(EntryNo);
        DamageEntry.Repaired := true;
        DamageEntry.Modify(true);
        OpenDamage.SetRange("Vehicle No.", DamageEntry."Vehicle No.");
        OpenDamage.SetRange(Repaired, false);
        if Vehicle.Get(DamageEntry."Vehicle No.") then begin
            Vehicle."Open Damages" := OpenDamage.Count();
            Vehicle.Blocked := Vehicle."Open Damages" > 0;
            Vehicle.Modify(true);
        end;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDamageRegistered(var DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
