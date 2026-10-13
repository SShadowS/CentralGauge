codeunit 70116 "CGR Workshop Repair Run"
{
    procedure RepairBatch(EntryNos: List of [Integer])
    var
        DamageEntry: Record "CGR Damage Entry";
        Hold: Codeunit "CGR Workshop Hold";
        DamageMgt: Codeunit "CGR Damage Mgt";
        VehicleNos: List of [Code[20]];
        EntryNo: Integer;
    begin
        foreach EntryNo in EntryNos do
            if DamageEntry.Get(EntryNo) then
                if not VehicleNos.Contains(DamageEntry."Vehicle No.") then
                    VehicleNos.Add(DamageEntry."Vehicle No.");

        Hold.HoldVehicles(VehicleNos);
        BindSubscription(Hold);
        foreach EntryNo in EntryNos do
            DamageMgt.RepairDamage(EntryNo);
        UnbindSubscription(Hold);
        Hold.ReleaseAll();
    end;
}
