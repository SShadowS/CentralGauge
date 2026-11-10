# Bug 5160: Repaired vehicles stay blocked

Reported by Workshop planning.

A vehicle is blocked while it has unrepaired damage. Since the last release, vehicles stay blocked after their last damage has been repaired, and the "Open Damages" number on the vehicle shows how many damages have been repaired so far.

Expected: on every vehicle, "Open Damages" is the number of its unrepaired damage entries, and Blocked is true exactly when that number is above 0. That holds after a repair, after a vehicle comes back from a rental with new damage (`CGR Rental Mgt`.`Return`), and whenever damage entries are removed, whether by our yearly cleanup (`CGR Damage Cleanup`.`PurgeOlderThan`) or by the insurer's archive app, which deletes damage rows from its own code, singly or in bulk and with or without running triggers. A return still records the mileage and frees the vehicle, and the cleanup still stamps "Last Damage Cleanup" on every vehicle it purged entries for.

Shipped code:

```al
// Fleet
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
        OpenDamage.SetRange(Repaired, true);
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

codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure BlockDamagedVehicle(var DamageEntry: Record "CGR Damage Entry")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(DamageEntry."Vehicle No.") then
            exit;
        Vehicle."Open Damages" += 1;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}

codeunit 70103 "CGR Fleet Return Handler"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure HandleVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        if DamageDescription <> '' then
            DamageMgt.RegisterDamage(VehicleNo, DamageDescription);
        Vehicle."Checked Out" := false;
        Vehicle.Mileage := ReturnKm;
        Vehicle.Modify(true);
    end;
}

codeunit 70177 "CGR Damage Cleanup"
{
    procedure PurgeOlderThan(CutoffDate: Date): Integer
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Purged: Integer;
    begin
        if Vehicle.FindSet() then
            repeat
                DamageEntry.SetRange("Vehicle No.", Vehicle."No.");
                DamageEntry.SetRange("Reported On", 0D, CutoffDate);
                if not DamageEntry.IsEmpty() then begin
                    Purged += DamageEntry.Count();
                    DamageEntry.DeleteAll();
                    Vehicle."Last Damage Cleanup" := WorkDate();
                    Vehicle.Modify(true);
                end;
            until Vehicle.Next() = 0;
        exit(Purged);
    end;
}

// Fleet (existing)
table 70101 "CGR Damage Entry"
{
    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(3; Description; Text[100]) { }
        field(4; "Reported On"; Date) { }
        field(5; Repaired; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Vehicle; "Vehicle No.", Repaired) { }
    }
}
```

The insurer's archive app cannot be changed and must not need to call anything of ours.

Write the corrected AL for every affected object, and any object you add, and explain briefly.
