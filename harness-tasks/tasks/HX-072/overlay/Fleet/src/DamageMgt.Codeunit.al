codeunit 70102 "CGR Damage Mgt"
{
    procedure RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer
    begin
        exit(RegisterDamageWithSeverity(VehicleNo, Description, Enum::"CGR Damage Severity"::Major));
    end;

    procedure RegisterDamageWithSeverity(VehicleNo: Code[20]; Description: Text[100]; Severity: Enum "CGR Damage Severity"): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := WorkDate();
        DamageEntry.Severity := Severity;
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
            OpenDamage.SetFilter(Severity, '<>%1', OpenDamage.Severity::Minor);
            Vehicle.Blocked := not OpenDamage.IsEmpty();
            Vehicle.Modify(true);
        end;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDamageRegistered(var DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
