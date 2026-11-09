codeunit 80643 "CGR Yard Triggers Spy"
{
    EventSubscriberInstance = Manual;

    var
        TriggersClearHits: Integer;
        TriggersRefusedNo: Code[20];
        TriggersRefusedErr: Label 'Refused for %1.', Comment = '%1 = vehicle number';

    procedure RefuseTriggersClear(VehicleNo: Code[20])
    begin
        TriggersRefusedNo := VehicleNo;
    end;

    procedure TriggersClearCount(): Integer
    begin
        exit(TriggersClearHits);
    end;

    procedure TriggersRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(TriggersRefusedErr, VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Yard Finding Sync", 'OnVehicleClearOfFindings', '', false, false)]
    local procedure TriggersTrackClear(VehicleNo: Code[20])
    begin
        TriggersClearHits += 1;
        if (TriggersRefusedNo <> '') and (VehicleNo = TriggersRefusedNo) then
            Error(TriggersRefusedErr, VehicleNo);
    end;
}
