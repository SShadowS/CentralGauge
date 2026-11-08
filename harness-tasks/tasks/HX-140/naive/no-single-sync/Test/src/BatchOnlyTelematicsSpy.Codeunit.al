codeunit 80486 "CGR Batch Only Telematics Spy"
{
    EventSubscriberInstance = Manual;

    var
        BatchOnlyRefusedNo: Code[20];
        BatchOnlySeen: Dictionary of [Code[20], Integer];
        BatchOnlyMarks: Dictionary of [Code[20], Boolean];
        BatchOnlyCompleted: Integer;
        BatchOnlyCompletedVehicles: Integer;
        BatchOnlyRefusedErr: Label 'Telematics partner rejected vehicle %1.', Comment = '%1 = vehicle number';

    procedure BatchOnlyRefuse(VehicleNo: Code[20])
    begin
        BatchOnlyRefusedNo := VehicleNo;
    end;

    procedure BatchOnlyRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(BatchOnlyRefusedErr, VehicleNo));
    end;

    procedure BatchOnlyPayloads(VehicleNo: Code[20]): Integer
    var
        Seen: Integer;
    begin
        if BatchOnlySeen.Get(VehicleNo, Seen) then
            exit(Seen);
        exit(0);
    end;

    procedure BatchOnlyMarked(VehicleNo: Code[20]): Boolean
    var
        Marked: Boolean;
    begin
        if BatchOnlyMarks.Get(VehicleNo, Marked) then
            exit(Marked);
        exit(false);
    end;

    procedure BatchOnlyCompletedCalls(): Integer
    begin
        exit(BatchOnlyCompleted);
    end;

    procedure BatchOnlyCompletedCount(): Integer
    begin
        exit(BatchOnlyCompletedVehicles);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnSendVehicle', '', false, false)]
    local procedure BatchOnlyReceivePayload(VehicleNo: Code[20]; Payload: JsonObject)
    var
        BatchToken: JsonToken;
        Marked: Boolean;
    begin
        BatchOnlySeen.Set(VehicleNo, BatchOnlyPayloads(VehicleNo) + 1);
        if Payload.Get('batch', BatchToken) then
            Marked := BatchToken.AsValue().AsBoolean();
        BatchOnlyMarks.Set(VehicleNo, Marked);
        if (BatchOnlyRefusedNo <> '') and (VehicleNo = BatchOnlyRefusedNo) then
            Error(BatchOnlyRefusedErr, VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnBatchCompleted', '', false, false)]
    local procedure BatchOnlyReceiveBatchEnd(VehicleCount: Integer)
    begin
        BatchOnlyCompleted += 1;
        BatchOnlyCompletedVehicles := VehicleCount;
    end;
}
