codeunit 88481 "HX168 Rate Change Runner"
{
    var
        RunRateCode: Code[20];
        RunDayRate: Decimal;
        RunMode: Option Change,ChangeThenFail,DeleteThenQuote,ChangeForgetThenFail,InsertThenFail;
        CallerFailedTxt: Label 'HX168 the desk stopped the change.', Locked = true;

    procedure SetChangeHX168(RateCode: Code[20]; NewDayRate: Decimal; CallerFails: Boolean)
    begin
        RunRateCode := RateCode;
        RunDayRate := NewDayRate;
        if CallerFails then
            RunMode := RunMode::ChangeThenFail
        else
            RunMode := RunMode::Change;
    end;

    procedure SetDeleteThenQuoteHX168(RateCode: Code[20])
    begin
        RunRateCode := RateCode;
        RunMode := RunMode::DeleteThenQuote;
    end;

    procedure SetChangeForgetThenFailHX168(RateCode: Code[20]; NewDayRate: Decimal)
    begin
        RunRateCode := RateCode;
        RunDayRate := NewDayRate;
        RunMode := RunMode::ChangeForgetThenFail;
    end;

    procedure SetInsertThenFailHX168(RateCode: Code[20]; DayRate: Decimal)
    begin
        RunRateCode := RateCode;
        RunDayRate := DayRate;
        RunMode := RunMode::InsertThenFail;
    end;

    trigger OnRun()
    var
        DeskRate: Record "CGR Desk Rate";
        RateUpdate: Codeunit "CGR Desk Rate Update";
        RateQuote: Codeunit "CGR Desk Rate Quote";
    begin
        case RunMode of
            RunMode::DeleteThenQuote:
                begin
                    DeskRate.Get(RunRateCode);
                    DeskRate.Delete();
                    RateQuote.QuoteDeskRate(RunRateCode);
                    exit;
                end;
            RunMode::InsertThenFail:
                begin
                    DeskRate.Init();
                    DeskRate.Code := RunRateCode;
                    DeskRate."Day Rate" := RunDayRate;
                    DeskRate."Season Surcharge %" := 5;
                    DeskRate.Insert();
                    RateQuote.QuoteDeskRate(RunRateCode);
                    Error(CallerFailedTxt);
                end;
        end;
        RateUpdate.SetDeskDayRate(RunRateCode, RunDayRate);
        case RunMode of
            RunMode::Change:
                exit;
            RunMode::ChangeForgetThenFail:
                RateQuote.ForgetDeskQuotes();
        end;
        RateQuote.QuoteDeskRate(RunRateCode);
        Error(CallerFailedTxt);
    end;
}
