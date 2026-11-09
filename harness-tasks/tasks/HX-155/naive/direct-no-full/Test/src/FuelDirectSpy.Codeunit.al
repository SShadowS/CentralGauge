codeunit 80624 "CGR Fuel Direct Spy"
{
    EventSubscriberInstance = Manual;

    var
        DirectLevelPct: Integer;

    procedure SetLevel(Pct: Integer)
    begin
        DirectLevelPct := Pct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fuel Charge", 'OnGetFuelLevel', '', false, false)]
    local procedure ReportDirectFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)
    begin
        LevelPct := DirectLevelPct;
    end;
}
