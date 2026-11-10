codeunit 80628 "CGR Fuel Single Charge Spy"
{
    EventSubscriberInstance = Manual;

    var
        SingleChargeLevelPct: Integer;

    procedure SetLevel(Pct: Integer)
    begin
        SingleChargeLevelPct := Pct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fuel Charge", 'OnGetFuelLevel', '', false, false)]
    local procedure ReportSingleChargeFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)
    begin
        LevelPct := SingleChargeLevelPct;
    end;
}
