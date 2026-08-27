codeunit 71390 "CG X050 Teller"
{
    Access = Internal;

    procedure BatchDigest(BatchId: Integer): Integer
    var
        Entry: Record "CG X050 Entry";
        Router: Codeunit "CG X050 Router";
        AnchorAmount: Integer;
        SumAmount: Integer;
        NewestAmount: Integer;
    begin
        Router.Prepare(BatchId, Entry);
        AnchorAmount := Entry.Amount;

        Entry.Reset();
        Entry.SetRange("Batch Id", BatchId);
        if Entry.FindSet() then
            repeat
                SumAmount += Entry.Amount;
            until Entry.Next() = 0;

        Entry.Reset();
        Entry.SetRange("Batch Id", BatchId);
        Entry.SetCurrentKey("Entry No.");
        if Entry.FindLast() then
            NewestAmount := Entry.Amount;

        exit((AnchorAmount * 1000) + SumAmount + (NewestAmount * 10));
    end;
}