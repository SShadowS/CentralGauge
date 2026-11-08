codeunit 80484 "CGR Rerun Telematics Spy"
{
    EventSubscriberInstance = Manual;

    var
        RerunRefusedNo: Code[20];
        RerunSeen: Dictionary of [Code[20], Integer];
        RerunMarks: Dictionary of [Code[20], Boolean];
        RerunCompleted: Integer;
        RerunCompletedVehicles: Integer;
        RerunRefusedErr: Label 'Partner refused telematics vehicle %1.', Comment = '%1 = vehicle number';

    procedure RerunRefuse(VehicleNo: Code[20])
    begin
        RerunRefusedNo := VehicleNo;
    end;

    procedure RerunRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(RerunRefusedErr, VehicleNo));
    end;

    procedure RerunPayloads(VehicleNo: Code[20]): Integer
    var
        Seen: Integer;
    begin
        if RerunSeen.Get(VehicleNo, Seen) then
            exit(Seen);
        exit(0);
    end;

    procedure RerunMarkedBatch(VehicleNo: Code[20]): Boolean
    var
        Marked: Boolean;
    begin
        if RerunMarks.Get(VehicleNo, Marked) then
            exit(Marked);
        exit(false);
    end;

    procedure RerunCompletedCalls(): Integer
    begin
        exit(RerunCompleted);
    end;

    procedure RerunCompletedCount(): Integer
    begin
        exit(RerunCompletedVehicles);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnSendVehicle', '', false, false)]
    local procedure RerunReceivePayload(VehicleNo: Code[20]; Payload: JsonObject)
    var
        BatchToken: JsonToken;
        Marked: Boolean;
    begin
        RerunSeen.Set(VehicleNo, RerunPayloads(VehicleNo) + 1);
        if Payload.Get('batch', BatchToken) then
            Marked := BatchToken.AsValue().AsBoolean();
        RerunMarks.Set(VehicleNo, Marked);
        if (RerunRefusedNo <> '') and (VehicleNo = RerunRefusedNo) then
            Error(RerunRefusedErr, VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnBatchCompleted', '', false, false)]
    local procedure RerunReceiveBatchEnd(VehicleCount: Integer)
    begin
        RerunCompleted += 1;
        RerunCompletedVehicles := VehicleCount;
    end;
}
