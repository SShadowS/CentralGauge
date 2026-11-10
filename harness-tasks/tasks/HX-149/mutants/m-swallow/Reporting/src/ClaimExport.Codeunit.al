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
                if TryExportDamage(Damage) then begin
                    Damage.Claimed := true;
                    Damage.Modify();
                    Sent += 1;
                end;
            until Damage.Next() = 0;
    end;

    [TryFunction]
    local procedure TryExportDamage(DamageEntry: Record "CGR Damage Entry")
    begin
        OnExportDamage(DamageEntry);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnExportDamage(DamageEntry: Record "CGR Damage Entry")
    begin
    end;
}
