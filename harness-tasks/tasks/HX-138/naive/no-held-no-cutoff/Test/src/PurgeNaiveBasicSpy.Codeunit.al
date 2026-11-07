codeunit 80466 "CGR Purge Naive Basic Spy"
{
    EventSubscriberInstance = Manual;

    var
        VetoedEntryNo: Integer;
        BasicVetoErr: Label 'Partner veto on outbox entry %1.', Comment = '%1 = entry number';

    procedure VetoBasicPurgeOf(EntryNo: Integer)
    begin
        VetoedEntryNo := EntryNo;
    end;

    procedure BasicVetoText(EntryNo: Integer): Text
    begin
        exit(StrSubstNo(BasicVetoErr, EntryNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Purge", 'OnBeforePurgeEntry', '', false, false)]
    local procedure VetoBasicEntry(Entry: Record "CGR Outbox Entry")
    begin
        if (VetoedEntryNo <> 0) and (Entry."Entry No." = VetoedEntryNo) then
            Error(BasicVetoErr, Entry."Entry No.");
    end;
}
