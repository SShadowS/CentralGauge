codeunit 70104 "CGR Vehicle Block Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Damage Mgt", 'OnAfterDamageRegistered', '', false, false)]
    local procedure BlockDamagedVehicle(var DamageEntry: Record "CGR Damage Entry")
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        SeverityRule: Interface "CGR Damage Severity Rule";
        IsBlocking: Boolean;
    begin
        if not Vehicle.Get(DamageEntry."Vehicle No.") then
            exit;
        Vehicle."Open Damages" += 1;
        if DamageEntry."Vehicle No." = '' then
            IsBlocking := DamageMgt.IsBlockingSeverity(DamageEntry.Severity)
        else begin
            SeverityRule := DamageEntry.Severity;
            IsBlocking := SeverityRule.BlocksVehicle();
        end;
        if IsBlocking then
            Vehicle.Blocked := true;
        Vehicle.Modify(true);
    end;
}
