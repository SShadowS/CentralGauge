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
