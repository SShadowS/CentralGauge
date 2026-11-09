codeunit 70580 "CGR Quote Mgt"
{
    var
        NoQuoteErr: Label 'There is no quote for vehicle %1 from %2 to %3.', Comment = '%1 = vehicle number, %2 = start date, %3 = end date';

    procedure Quote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        QuoteCache: Codeunit "CGR Quote Cache";
        Premium: Decimal;
        Price: Decimal;
    begin
        if QuoteCache.TryGet(VehicleNo, StartDate, EndDate, Price) then
            exit(Price);
        Vehicle.Get(VehicleNo);
        OnGetPremium(VehicleNo, EndDate - StartDate + 1, Premium);
        Price := (EndDate - StartDate + 1) * Vehicle."Daily Rate" + Premium;
        QuoteCache.Put(VehicleNo, StartDate, EndDate, Price);
        exit(Price);
    end;

    procedure BookQuote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; CustomerName: Text[100]): Code[20]
    var
        QuoteCache: Codeunit "CGR Quote Cache";
        Booking: Codeunit "CGR Quote Booking";
        Price: Decimal;
    begin
        if not QuoteCache.TryGet(VehicleNo, StartDate, EndDate, Price) then
            Error(NoQuoteErr, VehicleNo, StartDate, EndDate);
        Booking.SetQuote(VehicleNo, StartDate, EndDate, CustomerName, Price);
        if not TryBookKeptQuote(Booking) then
            Error(GetLastErrorText());
        QuoteCache.DropKeptQuote(VehicleNo, StartDate, EndDate);
        exit(Booking.BookedQuoteContractNo());
    end;

    [TryFunction]
    local procedure TryBookKeptQuote(var Booking: Codeunit "CGR Quote Booking")
    begin
        Booking.BookInPlace();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnGetPremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)
    begin
    end;
}
