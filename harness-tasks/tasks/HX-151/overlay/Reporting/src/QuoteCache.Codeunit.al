codeunit 70581 "CGR Quote Cache"
{
    SingleInstance = true;

    var
        KeptQuotes: Dictionary of [Text, Decimal];

    procedure Put(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; Price: Decimal)
    begin
        KeptQuotes.Set(KeptQuoteKey(VehicleNo, StartDate, EndDate), Price);
    end;

    procedure TryGet(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; var Price: Decimal): Boolean
    begin
        exit(KeptQuotes.Get(KeptQuoteKey(VehicleNo, StartDate, EndDate), Price));
    end;

    procedure DropKeptQuote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date)
    begin
        if KeptQuotes.Remove(KeptQuoteKey(VehicleNo, StartDate, EndDate)) then;
    end;

    procedure Reset()
    begin
        Clear(KeptQuotes);
    end;

    local procedure KeptQuoteKey(VehicleNo: Code[20]; StartDate: Date; EndDate: Date): Text
    begin
        exit(VehicleNo);
    end;
}
