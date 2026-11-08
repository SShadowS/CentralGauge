codeunit 80481 "CGR Telematics Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedVehicleNo: Code[20];
        PayloadsSeen: Dictionary of [Code[20], Integer];
        LastBatchMarks: Dictionary of [Code[20], Boolean];
        CompletedCalls: Integer;
        CompletedVehicleCount: Integer;
        PartnerRefusedErr: Label 'The telematics partner refused vehicle %1.', Comment = '%1 = vehicle number';

    procedure RefuseTelematicsVehicle(VehicleNo: Code[20])
    begin
        RefusedVehicleNo := VehicleNo;
    end;

    procedure TelematicsRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, VehicleNo));
    end;

    procedure PayloadsSentFor(VehicleNo: Code[20]): Integer
    var
        Seen: Integer;
    begin
        if PayloadsSeen.Get(VehicleNo, Seen) then
            exit(Seen);
        exit(0);
    end;

    procedure LastPayloadMarkedBatch(VehicleNo: Code[20]): Boolean
    var
        Marked: Boolean;
    begin
        if LastBatchMarks.Get(VehicleNo, Marked) then
            exit(Marked);
        exit(false);
    end;

    procedure BatchCompletedCalls(): Integer
    begin
        exit(CompletedCalls);
    end;

    procedure BatchCompletedVehicleCount(): Integer
    begin
        exit(CompletedVehicleCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnSendVehicle', '', false, false)]
    local procedure ReceiveTelematicsPayload(VehicleNo: Code[20]; Payload: JsonObject)
    var
        BatchToken: JsonToken;
        Marked: Boolean;
    begin
        PayloadsSeen.Set(VehicleNo, PayloadsSentFor(VehicleNo) + 1);
        if Payload.Get('batch', BatchToken) then
            Marked := BatchToken.AsValue().AsBoolean();
        LastBatchMarks.Set(VehicleNo, Marked);
        if (RefusedVehicleNo <> '') and (VehicleNo = RefusedVehicleNo) then
            Error(PartnerRefusedErr, VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnBatchCompleted', '', false, false)]
    local procedure ReceiveTelematicsBatchEnd(VehicleCount: Integer)
    begin
        CompletedCalls += 1;
        CompletedVehicleCount := VehicleCount;
    end;
}
