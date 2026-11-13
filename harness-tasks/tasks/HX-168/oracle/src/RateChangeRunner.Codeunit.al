codeunit 88481 "HX168 Rate Change Runner"
{
    var
        RunRateCode: Code[20];
        RunDayRate: Decimal;
        RunCallerFails: Boolean;
        RunDeleteThenQuote: Boolean;
        CallerFailedTxt: Label 'HX168 the desk stopped the change.', Locked = true;

    procedure SetChangeHX168(RateCode: Code[20]; NewDayRate: Decimal; CallerFails: Boolean)
    begin
        RunRateCode := RateCode;
        RunDayRate := NewDayRate;
        RunCallerFails := CallerFails;
        RunDeleteThenQuote := false;
    end;

    procedure SetDeleteThenQuoteHX168(RateCode: Code[20])
    begin
        RunRateCode := RateCode;
        RunDeleteThenQuote := true;
    end;

    trigger OnRun()
    var
        DeskRate: Record "CGR Desk Rate";
        RateUpdate: Codeunit "CGR Desk Rate Update";
        RateQuote: Codeunit "CGR Desk Rate Quote";
    begin
        if RunDeleteThenQuote then begin
            DeskRate.Get(RunRateCode);
            DeskRate.Delete();
            RateQuote.QuoteDeskRate(RunRateCode);
            exit;
        end;
        RateUpdate.SetDeskDayRate(RunRateCode, RunDayRate);
        if not RunCallerFails then
            exit;
        RateQuote.QuoteDeskRate(RunRateCode);
        Error(CallerFailedTxt);
    end;
}
