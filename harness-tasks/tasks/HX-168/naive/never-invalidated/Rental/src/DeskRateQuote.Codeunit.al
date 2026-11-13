codeunit 70253 "CGR Desk Rate Quote"
{
    SingleInstance = true;

    var
        DeskQuotes: Dictionary of [Code[20], Decimal];

    procedure QuoteDeskRate(RateCode: Code[20]): Decimal
    var
        DeskRate: Record "CGR Desk Rate";
        Quote: Decimal;
    begin
        if DeskQuotes.Get(RateCode, Quote) then
            exit(Quote);
        DeskRate.Get(RateCode);
        Quote := Round(DeskRate."Day Rate" * (100 + DeskRate."Season Surcharge %") / 100, 0.01);
        DeskQuotes.Add(RateCode, Quote);
        exit(Quote);
    end;

    procedure ForgetDeskQuotes()
    begin
        Clear(DeskQuotes);
    end;
}
