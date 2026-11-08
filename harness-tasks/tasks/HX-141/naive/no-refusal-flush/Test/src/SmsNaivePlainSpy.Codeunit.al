codeunit 80495 "CGR SMS Naive Plain Spy"
{
    EventSubscriberInstance = Manual;

    var
        PlainKeyBoxVehicleNo: Code[20];
        PlainSmsSeen: Integer;
        PlainKeyBoxErr: Label 'Key box blocked vehicle %1.', Comment = '%1 = vehicle number';

    procedure BlockKeysPlain(VehicleNo: Code[20])
    begin
        PlainKeyBoxVehicleNo := VehicleNo;
    end;

    procedure PlainKeyBoxText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(PlainKeyBoxErr, VehicleNo));
    end;

    procedure PlainSmsCount(): Integer
    begin
        exit(PlainSmsSeen);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure PlainKeyBoxCheck(VehicleNo: Code[20])
    begin
        if (PlainKeyBoxVehicleNo <> '') and (VehicleNo = PlainKeyBoxVehicleNo) then
            Error(PlainKeyBoxErr, VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR SMS Send", 'OnSendSms', '', false, false)]
    local procedure PlainCountSms(ContractNo: Code[20]; MessageText: Text)
    begin
        PlainSmsSeen += 1;
    end;
}
