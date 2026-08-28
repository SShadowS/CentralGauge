codeunit 71010 "CG X141 Period Statement Feed"
{
    procedure FeedBatchToStatement(BatchName: Code[10])
    var
        JournalLedgerEntry: Record "CG X110 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
    begin
        JournalLedgerEntry.SetRange("Batch Name", BatchName);
        if JournalLedgerEntry.FindSet() then
            repeat
                StatementBuilder.RecordEntry(
                    JournalLedgerEntry."Account No.", JournalLedgerEntry."Posting Date",
                    JournalLedgerEntry.Amount, JournalLedgerEntry.Description);
            until JournalLedgerEntry.Next() = 0;
    end;
}
