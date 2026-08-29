codeunit 71503 "CG X166 Statement Builder"
{
    /// Rebuilds an account's statement lines, in posting order, each
    /// carrying the running balance after that entry, and brings the
    /// account's closing balance in step with the last line.
    procedure RebuildStatement(AccountNo: Code[20]; var StatementLine: Record "CG X166 Statement Line" temporary)
    var
        Account: Record "CG X166 Account";
        LedgerEntry: Record "CG X166 Ledger Entry";
        PriorEntry: Record "CG X166 Ledger Entry";
        RunningBalance: Decimal;
    begin
        if not Account.Get(AccountNo) then
            Error(MissingAccountErr, AccountNo);

        StatementLine.SetRange("Account No.", AccountNo);
        StatementLine.DeleteAll();

        Account."Closing Balance" := 0;
        Account.Modify();

        LedgerEntry.SetCurrentKey("Account No.", "Posting Date", "Entry No.");
        LedgerEntry.SetRange("Account No.", AccountNo);
        if LedgerEntry.FindSet() then
            repeat
                // Recompute the running balance as of this entry by summing
                // every entry on the account up to and including this one -
                // entries sharing this entry's posting date but carrying a
                // higher entry number are excluded so the same-date order
                // still matches the account's own posting sequence.
                RunningBalance := 0;
                PriorEntry.SetCurrentKey("Account No.", "Posting Date", "Entry No.");
                PriorEntry.SetRange("Account No.", AccountNo);
                PriorEntry.SetFilter("Posting Date", '<=%1', LedgerEntry."Posting Date");
                if PriorEntry.FindSet() then
                    repeat
                        if (PriorEntry."Posting Date" < LedgerEntry."Posting Date") or
                           (PriorEntry."Entry No." <= LedgerEntry."Entry No.")
                        then
                            RunningBalance += PriorEntry.Amount;
                    until PriorEntry.Next() = 0;

                StatementLine.Init();
                StatementLine."Account No." := AccountNo;
                StatementLine."Entry No." := LedgerEntry."Entry No.";
                StatementLine."Posting Date" := LedgerEntry."Posting Date";
                StatementLine.Amount := LedgerEntry.Amount;
                StatementLine."Running Balance" := RunningBalance;
                StatementLine.Insert();

                Account.Get(AccountNo);
                Account."Closing Balance" := RunningBalance;
                Account.Modify();
            until LedgerEntry.Next() = 0;
    end;

    procedure ClosingBalanceOf(AccountNo: Code[20]): Decimal
    var
        Account: Record "CG X166 Account";
    begin
        if not Account.Get(AccountNo) then
            Error(MissingAccountErr, AccountNo);
        exit(Account."Closing Balance");
    end;

    var
        MissingAccountErr: Label 'Account %1 does not exist.', Comment = '%1 = account number';
}
