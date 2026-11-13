codeunit 70253 "CGR Desk Rate Quote"
{
    procedure QuoteDeskRate(RateCode: Code[20]): Decimal
    var
        DeskRate: Record "CGR Desk Rate";
    begin
        DeskRate.Get(RateCode);
        exit(Round(DeskRate."Day Rate" * (100 + DeskRate."Season Surcharge %") / 100, 0.01));
    end;
}
