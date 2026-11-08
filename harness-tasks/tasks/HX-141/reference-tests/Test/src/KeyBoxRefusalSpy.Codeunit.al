codeunit 80491 "CGR Key Box Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        KeyBoxVehicleNo: Code[20];
        KeyBoxRefusedErr: Label 'Key box refused to release the keys of vehicle %1.', Comment = '%1 = vehicle number';

    procedure RefuseKeysFor(VehicleNo: Code[20])
    begin
        KeyBoxVehicleNo := VehicleNo;
    end;

    procedure KeyBoxRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(KeyBoxRefusedErr, VehicleNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure RefuseKeyHandover(VehicleNo: Code[20])
    begin
        if (KeyBoxVehicleNo <> '') and (VehicleNo = KeyBoxVehicleNo) then
            Error(KeyBoxRefusedErr, VehicleNo);
    end;
}
