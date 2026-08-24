codeunit 70612 "CG X101 Statement Builder"
{
    procedure RecordEntry(AccountNo: Code[20]; PostingDate: Date; Amount: Decimal; Description: Text[100]): Integer
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        LastEntryNo: Integer;
    begin
        if LedgerEntry.FindLast() then
            LastEntryNo := LedgerEntry."Entry No.";
        LedgerEntry.Init();
        LedgerEntry."Entry No." := LastEntryNo + 1;
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Description := Description;
        LedgerEntry.Insert();
        exit(LedgerEntry."Entry No.");
    end;

    procedure BuildStatement(AccountNo: Code[20]; var StatementLine: Record "CG X101 Statement Line" temporary)
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        RunningBalance: Decimal;
        LineNo: Integer;
    begin
        StatementLine.Reset();
        StatementLine.DeleteAll();

        LedgerEntry.SetRange("Account No.", AccountNo);
        LineNo := LedgerEntry.Count();
        if LedgerEntry.FindSet() then
            repeat
                RunningBalance += LedgerEntry.Amount;
                StatementLine.Init();
                StatementLine."Line No." := LineNo;
                StatementLine."Entry No." := LedgerEntry."Entry No.";
                StatementLine."Posting Date" := LedgerEntry."Posting Date";
                StatementLine.Amount := LedgerEntry.Amount;
                StatementLine.Description := LedgerEntry.Description;
                StatementLine."Running Balance" := RunningBalance;
                StatementLine.Insert();
                LineNo -= 1;
            until LedgerEntry.Next() = 0;
    end;
}
