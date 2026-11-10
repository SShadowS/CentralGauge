codeunit 80647 "CGR Yard Single Delete Spy"
{
    EventSubscriberInstance = Manual;

    var
        SingleDeleteClearHits: Integer;
        SingleDeleteRefusedNo: Code[20];
        SingleDeleteRefusedErr: Label 'Refused for %1.', Comment = '%1 = vehicle number';

    procedure RefuseSingleDeleteClear(VehicleNo: Code[20])
    begin
        SingleDeleteRefusedNo := VehicleNo;
    end;

    procedure SingleDeleteClearCount(): Integer
    begin
        exit(SingleDeleteClearHits);
    end;

    procedure SingleDeleteRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(SingleDeleteRefusedErr, VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Yard Finding Sync", 'OnVehicleClearOfFindings', '', false, false)]
    local procedure SingleDeleteTrackClear(VehicleNo: Code[20])
    begin
        SingleDeleteClearHits += 1;
        if (SingleDeleteRefusedNo <> '') and (VehicleNo = SingleDeleteRefusedNo) then
            Error(SingleDeleteRefusedErr, VehicleNo);
    end;
}
