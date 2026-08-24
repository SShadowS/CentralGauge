codeunit 70703 "CG X110 Post Batch"
{
    var
        NothingToPostErr: Label 'There is nothing to post in batch %1.', Comment = '%1 = journal batch name';
        OutOfBalanceErr: Label 'Batch %1 is out of balance by %2.', Comment = '%1 = journal batch name, %2 = sum of the open line amounts';

    procedure PostBatch(BatchName: Code[10])
    var
        JournalLine: Record "CG X110 Journal Line";
        PostingLine: Record "CG X110 Journal Line";
        Total: Decimal;
        NextEntryNo: Integer;
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        JournalLine.SetRange(Status, "CG X110 Journal Status"::Open);
        if not JournalLine.FindSet() then
            Error(NothingToPostErr, BatchName);

        // First pass validates every open line and totals the batch before
        // anything is written.
        repeat
            JournalLine.TestField("Account No.");
            JournalLine.TestField("Posting Date");
            JournalLine.TestField(Amount);
            Total += JournalLine.Amount;
        until JournalLine.Next() = 0;

        if Total <> 0 then
            Error(OutOfBalanceErr, BatchName, Total);

        NextEntryNo := GetNextEntryNo();

        // Second pass writes the ledger entries. A fresh record variable
        // keeps the write loop from disturbing the validation cursor above.
        PostingLine.SetRange("Batch Name", BatchName);
        if PostingLine.FindSet(true) then
            repeat
                InsertLedgerEntry(PostingLine, NextEntryNo);
                NextEntryNo += 1;
                PostingLine.Status := "CG X110 Journal Status"::Posted;
                PostingLine.Modify();
            until PostingLine.Next() = 0;
    end;

    local procedure GetNextEntryNo(): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
    begin
        LedgerEntry.LockTable();
        if LedgerEntry.FindLast() then
            exit(LedgerEntry."Entry No." + 1);
        exit(1);
    end;

    local procedure InsertLedgerEntry(JournalLine: Record "CG X110 Journal Line"; EntryNo: Integer)
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Entry No." := EntryNo;
        LedgerEntry."Account No." := JournalLine."Account No.";
        LedgerEntry."Posting Date" := JournalLine."Posting Date";
        LedgerEntry.Description := JournalLine.Description;
        LedgerEntry.Amount := JournalLine.Amount;
        LedgerEntry."Batch Name" := JournalLine."Batch Name";
        LedgerEntry.Insert();
    end;
}
