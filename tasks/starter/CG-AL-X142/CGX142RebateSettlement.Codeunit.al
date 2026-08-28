codeunit 71040 "CG X142 Rebate Settlement"
{
    /// <summary>
    /// Books an already-allocated rebate document's lines into the ledger,
    /// one balanced entry per line, using each line's already-recorded
    /// Rebate Amount. A document's line "Line No." N is booked at ledger
    /// Entry No. EntryNoBase + N.
    /// </summary>
    procedure SettleRebate(DocumentNo: Code[20]; EntryNoBase: Integer; AccountNo: Code[20]; CounterAccountNo: Code[20])
    var
        RebateLine: Record "CG X140 Rebate Line";
        JournalLine: Record "CG X118 Journal Line";
    begin
        RebateLine.SetRange("Document No.", DocumentNo);
        if RebateLine.FindSet() then
            repeat
                JournalLine.Init();
                JournalLine."Entry No." := EntryNoBase + RebateLine."Line No.";
                JournalLine.Insert(true);
                JournalLine.Validate("Account No.", AccountNo);
                JournalLine.Validate(Amount, RebateLine."Rebate Amount");
                JournalLine.Validate("Counter Account No.", CounterAccountNo);
                JournalLine.Modify(true);
            until RebateLine.Next() = 0;
    end;
}
