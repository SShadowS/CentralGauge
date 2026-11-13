codeunit 70254 "CGR Desk Rate Update"
{
    var
        BelowMinimumQuoteErr: Label 'Desk rate %1 is below its minimum quote.', Comment = '%1 = desk rate code';

    procedure SetDeskDayRate(RateCode: Code[20]; NewDayRate: Decimal)
    var
        DeskRate: Record "CGR Desk Rate";
        RateQuote: Codeunit "CGR Desk Rate Quote";
    begin
        DeskRate.Get(RateCode);
        DeskRate."Day Rate" := NewDayRate;
        DeskRate.Modify(true);
        if RateQuote.QuoteDeskRate(RateCode) < DeskRate."Minimum Quote" then
            Error(BelowMinimumQuoteErr, RateCode);
        OnAfterDeskRateChanged(RateCode);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeskRateChanged(RateCode: Code[20])
    begin
    end;
}
