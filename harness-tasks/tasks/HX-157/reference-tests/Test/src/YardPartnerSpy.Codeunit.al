codeunit 80641 "CGR Yard Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        VehicleClearEvents: Integer;
        RefusingVehicleNo: Code[20];
        YardPartnerRefusedErr: Label 'The partner app refused the clearing of vehicle %1.', Comment = '%1 = vehicle number';

    procedure RefuseVehicleClear(VehicleNo: Code[20])
    begin
        RefusingVehicleNo := VehicleNo;
    end;

    procedure VehicleClearCount(): Integer
    begin
        exit(VehicleClearEvents);
    end;

    procedure YardRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(YardPartnerRefusedErr, VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Yard Finding Sync", 'OnVehicleClearOfFindings', '', false, false)]
    local procedure TrackVehicleClear(VehicleNo: Code[20])
    begin
        VehicleClearEvents += 1;
        if (RefusingVehicleNo <> '') and (VehicleNo = RefusingVehicleNo) then
            Error(YardPartnerRefusedErr, VehicleNo);
    end;
}
