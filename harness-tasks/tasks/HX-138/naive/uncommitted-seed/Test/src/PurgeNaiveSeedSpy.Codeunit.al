codeunit 80469 "CGR Purge Naive Seed Spy"
{
    EventSubscriberInstance = Manual;

    var
        VetoedEntryNo: Integer;
        SeedVetoErr: Label 'Partner refuses purging outbox entry %1.', Comment = '%1 = entry number';

    procedure VetoSeedPurgeOf(EntryNo: Integer)
    begin
        VetoedEntryNo := EntryNo;
    end;

    procedure SeedVetoText(EntryNo: Integer): Text
    begin
        exit(StrSubstNo(SeedVetoErr, EntryNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Purge", 'OnBeforePurgeEntry', '', false, false)]
    local procedure VetoSeedEntry(Entry: Record "CGR Outbox Entry")
    begin
        if (VetoedEntryNo <> 0) and (Entry."Entry No." = VetoedEntryNo) then
            Error(SeedVetoErr, Entry."Entry No.");
    end;
}
