codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure BlockDamagedVehicle(var DamageEntry: Record "CGR Damage Entry")
    begin
        BlockVehicle(DamageEntry."Vehicle No.");
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Damage Entry", 'OnAfterInsertEvent', '', false, false)]
    local procedure BlockOnDamageInsert(var Rec: Record "CGR Damage Entry"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if Rec.Repaired then
            exit;
        BlockVehicle(Rec."Vehicle No.");
    end;

    local procedure BlockVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if not Vehicle.Get(VehicleNo) then
            exit;
        Vehicle."Open Damages" += 1;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
