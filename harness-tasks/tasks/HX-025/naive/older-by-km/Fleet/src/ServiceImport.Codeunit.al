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
                    if ParsePortalDate(DateText, ServiceDate) then
                        // An older service has fewer km on the clock than the last one registered.
                        if ServiceKm >= Vehicle."Last Service Km" then begin
                            ServicePlanMgt.RegisterService(VehicleNo, ServiceDate, ServiceKm);
                            ImportedCount += 1;
                        end;
        end;
        exit(ImportedCount);
    end;

    local procedure ParsePortalDate(DateText: Text; var ServiceDate: Date): Boolean
    var
        DateParts: List of [Text];
        DayNo: Integer;
        MonthNo: Integer;
        YearNo: Integer;
    begin
        DateParts := DateText.Split('.');
        if DateParts.Count() <> 3 then
            exit(false);
        if not Evaluate(DayNo, DateParts.Get(1)) then
            exit(false);
        if not Evaluate(MonthNo, DateParts.Get(2)) then
            exit(false);
        if not Evaluate(YearNo, DateParts.Get(3)) then
            exit(false);
        if (MonthNo < 1) or (MonthNo > 12) or (YearNo < 1) or (YearNo > 9999) or (DayNo < 1) then
            exit(false);
        if DayNo > Date2DMY(CalcDate('<CM>', DMY2Date(1, MonthNo, YearNo)), 1) then
            exit(false);
        ServiceDate := DMY2Date(DayNo, MonthNo, YearNo);
        exit(true);
    end;
}
