codeunit 80461 "CGR Purge Veto Spy"
{
    EventSubscriberInstance = Manual;

    var
        VetoedEntryNo: Integer;
        PartnerVetoErr: Label 'Partner app vetoed the purge of outbox entry %1.', Comment = '%1 = entry number';

    procedure VetoPurgeOf(EntryNo: Integer)
    begin
        VetoedEntryNo := EntryNo;
    end;

    procedure PurgeVetoText(EntryNo: Integer): Text
    begin
        exit(StrSubstNo(PartnerVetoErr, EntryNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Purge", 'OnBeforePurgeEntry', '', false, false)]
    local procedure VetoOneEntry(Entry: Record "CGR Outbox Entry")
    begin
        if (VetoedEntryNo <> 0) and (Entry."Entry No." = VetoedEntryNo) then
            Error(PartnerVetoErr, Entry."Entry No.");
    end;
}
