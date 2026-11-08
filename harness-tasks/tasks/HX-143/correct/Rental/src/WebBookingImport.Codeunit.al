codeunit 70278"CGR Web Booking Import"
{
    var
        NotJsonErr: Label 'The booking is not a JSON object.';
        MissingFieldErr: Label 'The booking has no %1.', Comment = '%1 = field name';
        BadDateErr: Label 'The booking %1 is not a yyyy-mm-dd date.', Comment = '%1 = field name';

    procedure ImportBooking(BookingJson: Text): Boolean
    var
        Creator: Codeunit "CGR Web Booking Create";
        VehicleNo: Code[20];
        CustomerName: Text[100];
        StartDate: Date;
        EndDate: Date;
    begin
        ClearLastError();
        if not TryParse(BookingJson, VehicleNo, CustomerName, StartDate, EndDate) then begin
            LogError(BookingJson, GetLastErrorText());
            exit(false);
        end;
        Creator.SetBooking(VehicleNo, CustomerName, StartDate, EndDate);
        if not Creator.Run() then begin
            LogError(BookingJson, GetLastErrorText());
            exit(false);
        end;
        exit(true);
    end;

    [TryFunction]
    local procedure TryParse(BookingJson: Text; var VehicleNo: Code[20]; var CustomerName: Text[100]; var StartDate: Date; var EndDate: Date)
    var
        Booking: JsonObject;
    begin
        if not Booking.ReadFrom(BookingJson) then
            Error(NotJsonErr);
        VehicleNo := CopyStr(GetToken(Booking, 'vehicleNo').AsValue().AsText(), 1, MaxStrLen(VehicleNo));
        CustomerName := CopyStr(GetToken(Booking, 'customer').AsValue().AsText(), 1, MaxStrLen(CustomerName));
        StartDate := ReadDate(Booking, 'start');
        EndDate := ReadDate(Booking, 'end');
    end;

    local procedure GetToken(Booking: JsonObject; KeyName: Text) Token: JsonToken
    begin
        if not Booking.Get(KeyName, Token) then
            Error(MissingFieldErr, KeyName);
    end;

    local procedure ReadDate(Booking: JsonObject; KeyName: Text) Result: Date
    var
        DateText: Text;
        Index: Integer;
    begin
        DateText := GetToken(Booking, KeyName).AsValue().AsText();
        if StrLen(DateText) <> 10 then
            Error(BadDateErr, KeyName);
        for Index := 1 to 10 do
            if Index in [5, 8] then begin
                if DateText[Index] <> '-' then
                    Error(BadDateErr, KeyName);
            end else
                if not (DateText[Index] in ['0' .. '9']) then
                    Error(BadDateErr, KeyName);
        if not Evaluate(Result, DateText, 9) then
            Error(BadDateErr, KeyName);
    end;

    local procedure LogError(BookingJson: Text; ErrorText: Text)
    var
        BookingError: Record "CGR Web Booking Error";
    begin
        BookingError.Init();
        BookingError."Booking Text" := CopyStr(BookingJson, 1, MaxStrLen(BookingError."Booking Text"));
        BookingError."Error Text" := CopyStr(ErrorText, 1, MaxStrLen(BookingError."Error Text"));
        BookingError.Insert(true);
    end;
}
