codeunit 69992 "CG X050 Router"
{
    // Positions Entry on the batch's anchor row (the lowest-Amount Normal
    // entry, via the secondary Amount key) filtered to the requested batch.
    // The filters and current key set here to locate that anchor are left on
    // the caller's handle when this procedure returns - Entry is a `var`
    // parameter, and filters/current key are record-INSTANCE state that
    // travels with it.
    procedure Prepare(BatchId: Integer; var Entry: Record "CG X050 Entry")
    begin
        Entry.Reset();
        Entry.SetCurrentKey(Amount);
        Entry.SetRange("Batch Id", BatchId);
        Entry.SetRange(Kind, Entry.Kind::Normal);
        Entry.FindFirst();
    end;
}
