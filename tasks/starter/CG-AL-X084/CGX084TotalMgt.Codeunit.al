codeunit 70493 "CG X084 Total Mgt"
{
    // Tracks which ledger entries have been applied in the current session
    // and keeps a "CG X084 Total Buffer" row per applied entry showing its
    // own current remaining amount.
    var
        KnownEntryNo: List of [Integer];

    procedure Reset()
    begin
        Clear(KnownEntryNo);
    end;

    procedure AddAppliedEntry(var Buffer: Record "CG X084 Total Buffer" temporary; NewEntryNo: Integer)
    var
        LedgerEntry: Record "CG X084 Ledger Entry";
        ExistingEntryNo: Integer;
    begin
        if not KnownEntryNo.Contains(NewEntryNo) then
            KnownEntryNo.Add(NewEntryNo);

        Buffer.Reset();
        Buffer.DeleteAll();

        foreach ExistingEntryNo in KnownEntryNo do begin
            LedgerEntry.Get(ExistingEntryNo);
            LedgerEntry.CalcFields("Remaining Amount");

            Buffer.Init();
            Buffer."Entry No." := LedgerEntry."Entry No.";
            Buffer."Document No." := LedgerEntry."Document No.";
            Buffer."Remaining Amount" := LedgerEntry."Remaining Amount";
            Buffer.Insert();
        end;
    end;

    procedure RemoveAppliedEntry(var Buffer: Record "CG X084 Total Buffer" temporary; RemovedEntryNo: Integer)
    var
        RemoveIndex: Integer;
    begin
        RemoveIndex := KnownEntryNo.IndexOf(RemovedEntryNo);
        if RemoveIndex > 0 then
            KnownEntryNo.RemoveAt(RemoveIndex);

        if Buffer.Get(RemovedEntryNo) then
            Buffer.Delete();
    end;

    procedure GetBufferTotal(var Buffer: Record "CG X084 Total Buffer" temporary) Total: Decimal
    begin
        Buffer.Reset();
        if Buffer.FindSet() then
            repeat
                Total += Buffer."Remaining Amount";
            until Buffer.Next() = 0;
    end;

    procedure AppliedEntryCount(): Integer
    begin
        exit(KnownEntryNo.Count());
    end;
}
