codeunit 71503 "CG X166 Statement Builder"
{
    /// Rebuilds an account's statement lines, in posting order, each
    /// carrying the running balance after that entry, and brings the
    /// account's closing balance in step with the last line.
    procedure RebuildStatement(AccountNo: Code[20]; var StatementLine: Record "CG X166 Statement Line" temporary)
    var
        Account: Record "CG X166 Account";
        LedgerEntry: Record "CG X166 Ledger Entry";
        RunningBalance: Decimal;
    begin
        if not Account.Get(AccountNo) then
            Error(MissingAccountErr, AccountNo);

        StatementLine.SetRange("Account No.", AccountNo);
        StatementLine.DeleteAll();

        RunningBalance := 0;
        LedgerEntry.SetCurrentKey("Account No.", "Posting Date", "Entry No.");
        LedgerEntry.SetRange("Account No.", AccountNo);
        if LedgerEntry.FindSet() then
            repeat
                RunningBalance += LedgerEntry.Amount;

                StatementLine.Init();
                StatementLine."Account No." := AccountNo;
                StatementLine."Entry No." := LedgerEntry."Entry No.";
                StatementLine."Posting Date" := LedgerEntry."Posting Date";
                StatementLine.Amount := LedgerEntry.Amount;
                StatementLine."Running Balance" := RunningBalance;
                StatementLine.Insert();
            until LedgerEntry.Next() = 0;

        Account."Closing Balance" := RunningBalance;
        Account.Modify();
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
