codeunit 80622 "CGR Fuel Telematics Spy"
{
    EventSubscriberInstance = Manual;

    var
        TelematicsLevelPct: Integer;

    procedure SetLevel(Pct: Integer)
    begin
        TelematicsLevelPct := Pct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fuel Charge", 'OnGetFuelLevel', '', false, false)]
    local procedure ReportTelematicsFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)
    begin
        LevelPct := TelematicsLevelPct;
    end;
}
