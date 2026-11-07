codeunit 70462 "CGR Outbox Purge"
{
    var
        DeletedMsg: Label '%1 outbox entries were deleted.', Comment = '%1 = number of entries';

    procedure PurgeSent(OlderThan: DateTime): Integer
    var
        Entry: Record "CGR Outbox Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
        Deleted: Integer;
    begin
        Entry.SetRange(Sent, true);
        Entry.SetFilter("Created At", '<%1', OlderThan);
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;
        foreach EntryNo in EntryNos do begin
            Entry.Get(EntryNo);
            OnBeforePurgeEntry(Entry);
            Entry.Delete(true);
            Deleted += 1;
            if Deleted mod 500 = 0 then
                Commit();
        end;
        if GuiAllowed() then
            Message(DeletedMsg, Deleted);
        exit(Deleted);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforePurgeEntry(Entry: Record "CGR Outbox Entry")
    begin
    end;
}
