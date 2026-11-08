codeunit 70571 "CGR Claim Export"
{
    procedure ExportOpenDamages() Sent: Integer
    var
        Damage: Record "CGR Damage Entry";
    begin
        Damage.SetRange(Repaired, false);
        Damage.SetRange(Claimed, false);
        if Damage.FindSet(true) then
            repeat
                OnExportDamage(Damage);
                Damage.Claimed := true;
                Damage.Modify();
                Sent += 1;
            until Damage.Next() = 0;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnExportDamage(DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
