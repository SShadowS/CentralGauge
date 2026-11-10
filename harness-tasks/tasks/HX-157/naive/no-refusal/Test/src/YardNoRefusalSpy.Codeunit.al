codeunit 80649 "CGR Yard No Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        NoRefusalClearHits: Integer;

    procedure NoRefusalClearCount(): Integer
    begin
        exit(NoRefusalClearHits);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Yard Finding Sync", 'OnVehicleClearOfFindings', '', false, false)]
    local procedure NoRefusalTrackClear(VehicleNo: Code[20])
    begin
        NoRefusalClearHits += 1;
    end;
}
