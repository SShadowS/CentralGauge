codeunit 70783 "CG X118 Journal Line Mgt"
{
    Access = Public;

    /// <summary>
    /// Keeps a journal line's Balancing Amount in step with its Amount
    /// whenever the counter account changes.
    /// </summary>
    procedure AssignCounterAccount(var JournalLine: Record "CG X118 Journal Line")
    var
        CounterAccount: Record "CG X118 Account";
        OriginalCurrencyCode: Code[10];
    begin
        if JournalLine."Counter Account No." = '' then begin
            JournalLine."Balancing Amount" := 0;
            exit;
        end;

        CounterAccount.Get(JournalLine."Counter Account No.");

        OriginalCurrencyCode := JournalLine."Currency Code";
        JournalLine."Currency Code" := CounterAccount."Currency Code";

        JournalLine."Balancing Amount" := -Round(JournalLine.Amount, RoundingPrecisionFor(JournalLine."Currency Code"));

        JournalLine."Currency Code" := OriginalCurrencyCode;
    end;

    local procedure RoundingPrecisionFor(CurrencyCode: Code[10]): Decimal
    var
        Currency: Record "CG X118 Currency";
    begin
        if Currency.Get(CurrencyCode) then
            exit(Currency."Rounding Precision");
        exit(0.01);
    end;
}
