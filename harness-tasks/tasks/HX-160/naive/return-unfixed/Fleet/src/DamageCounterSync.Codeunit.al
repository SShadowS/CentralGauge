codeunit 70178 "CGR Damage Counter Sync"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Damage Entry", 'OnAfterDeleteEvent', '', false, false)]
    local procedure SyncOpenDamages(var Rec: Record "CGR Damage Entry"; RunTrigger: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Rec.IsTemporary() or Rec.Repaired then
            exit;
        if not Vehicle.Get(Rec."Vehicle No.") then
            exit;
        Vehicle."Open Damages" -= 1;
        Vehicle.Blocked := Vehicle."Open Damages" > 0;
        Vehicle.Modify(true);
    end;
}
