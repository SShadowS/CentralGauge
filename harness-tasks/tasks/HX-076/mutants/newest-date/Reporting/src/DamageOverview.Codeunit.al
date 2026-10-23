codeunit 70516 "CGR Damage Overview"
{
    procedure FillDamageOverview(VehicleFilter: Text; IncludeClean: Boolean; var OverviewLine: Record "CGR Damage Overview Line" temporary): Integer
    var
        Vehicle: Record "CGR Vehicle";
        OpenDamage: Record "CGR Damage Entry";
        Skip: Boolean;
        Stored: Integer;
    begin
        OverviewLine.Reset();
        OverviewLine.DeleteAll();
        Vehicle.SetFilter("No.", VehicleFilter);
        if Vehicle.FindSet() then
            repeat
                OpenDamage.SetRange("Vehicle No.", Vehicle."No.");
                OpenDamage.SetRange(Repaired, false);
                if IncludeClean or not OpenDamage.IsEmpty() then begin
                    OverviewLine.Init();
                    OverviewLine."Vehicle No." := Vehicle."No.";
                    OverviewLine."Open Damages" := OpenDamage.Count();
                    OverviewLine."Oldest Open Damage" := 0D;
                    if OpenDamage.FindSet() then
                        repeat
                            if (OverviewLine."Oldest Open Damage" = 0D) or (OpenDamage."Reported On" > OverviewLine."Oldest Open Damage") then
                                OverviewLine."Oldest Open Damage" := OpenDamage."Reported On";
                        until OpenDamage.Next() = 0;
                    OverviewLine.Blocked := Vehicle.Blocked;
                    Skip := false;
                    OnAfterFillOverviewLine(OverviewLine, Skip);
                    if not Skip then begin
                        OverviewLine.Insert();
                        Stored += 1;
                    end;
                end;
            until Vehicle.Next() = 0;
        exit(Stored);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterFillOverviewLine(var OverviewLine: Record "CGR Damage Overview Line"; var Skip: Boolean)
    begin
    end;
}
