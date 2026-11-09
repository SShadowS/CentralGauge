codeunit 80645 "CGR Yard No Draft Spy"
{
    EventSubscriberInstance = Manual;

    var
        NoDraftClearHits: Integer;
        NoDraftRefusedNo: Code[20];
        NoDraftRefusedErr: Label 'Refused for %1.', Comment = '%1 = vehicle number';

    procedure RefuseNoDraftClear(VehicleNo: Code[20])
    begin
        NoDraftRefusedNo := VehicleNo;
    end;

    procedure NoDraftClearCount(): Integer
    begin
        exit(NoDraftClearHits);
    end;

    procedure NoDraftRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(NoDraftRefusedErr, VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Yard Finding Sync", 'OnVehicleClearOfFindings', '', false, false)]
    local procedure NoDraftTrackClear(VehicleNo: Code[20])
    begin
        NoDraftClearHits += 1;
        if (NoDraftRefusedNo <> '') and (VehicleNo = NoDraftRefusedNo) then
            Error(NoDraftRefusedErr, VehicleNo);
    end;
}
