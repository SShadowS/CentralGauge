codeunit 80626 "CGR Fuel Half Only Spy"
{
    EventSubscriberInstance = Manual;

    var
        HalfOnlyLevelPct: Integer;

    procedure SetLevel(Pct: Integer)
    begin
        HalfOnlyLevelPct := Pct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Fuel Charge", 'OnGetFuelLevel', '', false, false)]
    local procedure ReportHalfOnlyFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)
    begin
        LevelPct := HalfOnlyLevelPct;
    end;
}
