codeunit 70116 "CGR Workshop Repair Run"
{
    procedure RepairBatch(EntryNos: List of [Integer])
    var
        DamageEntry: Record "CGR Damage Entry";
        Hold: Codeunit "CGR Workshop Hold";
        RepairUnit: Codeunit "CGR Workshop Repair Unit";
        VehicleNos: List of [Code[20]];
        EntryNo: Integer;
        Ok: Boolean;
        RepairError: Text;
    begin
        foreach EntryNo in EntryNos do
            if DamageEntry.Get(EntryNo) then
                if not VehicleNos.Contains(DamageEntry."Vehicle No.") then
                    VehicleNos.Add(DamageEntry."Vehicle No.");

        Hold.HoldVehicles(VehicleNos);
        BindSubscription(Hold);
        RepairUnit.SetEntries(EntryNos);
        Ok := RepairUnit.Run();
        if not Ok then
            RepairError := GetLastErrorText();
        UnbindSubscription(Hold);
        Hold.ReleaseAll();
        if not Ok then
            Error(RepairError);
    end;
}
