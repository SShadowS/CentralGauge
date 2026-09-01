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
        CounterCurrency: Record "CG X118 Currency";
    begin
        if JournalLine."Counter Account No." = '' then begin
            JournalLine."Balancing Amount" := 0;
            exit;
        end;

        CounterAccount.Get(JournalLine."Counter Account No.");
        if CounterCurrency.Get(CounterAccount."Currency Code") then
            if CounterCurrency."Rounding Precision" < 0 then
                Error('The currency on account %1 has an invalid rounding precision.', CounterAccount."No.");

        JournalLine."Balancing Amount" := -JournalLine.Amount;
    end;
}
