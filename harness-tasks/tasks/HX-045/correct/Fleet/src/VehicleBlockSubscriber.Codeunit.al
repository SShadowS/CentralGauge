codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Damage Entry", 'OnAfterInsertEvent', '', false, false)]
    local procedure BlockDamagedVehicle(var Rec: Record "CGR Damage Entry"; RunTrigger: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Rec.IsTemporary() then
            exit;
        if Rec.Repaired then
            exit;
        if not Vehicle.Get(Rec."Vehicle No.") then
            exit;
        Vehicle."Open Damages" += 1;
        Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
