codeunit 70177 "CGR Damage Cleanup"
{
    procedure PurgeOlderThan(CutoffDate: Date): Integer
    var
        Vehicle: Record "CGR Vehicle";
        StampVehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Purged: Integer;
    begin
        if Vehicle.FindSet() then
            repeat
                DamageEntry.SetRange("Vehicle No.", Vehicle."No.");
                DamageEntry.SetRange("Reported On", 0D, CutoffDate);
                if not DamageEntry.IsEmpty() then begin
                    Purged += DamageEntry.Count();
                    DamageEntry.DeleteAll(true);
                    StampVehicle.Get(Vehicle."No.");
                    StampVehicle."Last Damage Cleanup" := WorkDate();
                    StampVehicle.Modify(true);
                end;
            until Vehicle.Next() = 0;
        exit(Purged);
    end;
}
