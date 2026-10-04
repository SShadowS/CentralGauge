codeunit 70113 "CGR Service Import"
{
    procedure ImportServiceRecords(Payload: Text): Integer
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        ServiceRecords: JsonArray;
        RecordToken: JsonToken;
        RecordObject: JsonObject;
        FieldToken: JsonToken;
        VehicleNo: Code[20];
        DateText: Text;
        ServiceDate: Date;
        ServiceKm: Integer;
        ImportedCount: Integer;
    begin
        ServiceRecords.ReadFrom(Payload);
        foreach RecordToken in ServiceRecords do begin
            RecordObject := RecordToken.AsObject();
            RecordObject.Get('vehicleNo', FieldToken);
            VehicleNo := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(VehicleNo));
            RecordObject.Get('serviceDate', FieldToken);
            DateText := FieldToken.AsValue().AsText();
            RecordObject.Get('serviceKm', FieldToken);
            ServiceKm := FieldToken.AsValue().AsInteger();

            if Vehicle.Get(VehicleNo) then
                if ServiceKm <= Vehicle.Mileage then
                    if Evaluate(ServiceDate, DateText) then begin
                        ServicePlanMgt.RegisterService(VehicleNo, ServiceDate, ServiceKm);
                        ImportedCount += 1;
                    end;
        end;
        exit(ImportedCount);
    end;
}
