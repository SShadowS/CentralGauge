codeunit 80464 "CGR Purge Naive Small Spy"
{
    EventSubscriberInstance = Manual;

    var
        VetoedEntryNo: Integer;
        SmallVetoErr: Label 'Partner app vetoed outbox entry %1.', Comment = '%1 = entry number';

    procedure VetoSmallPurgeOf(EntryNo: Integer)
    begin
        VetoedEntryNo := EntryNo;
    end;

    procedure SmallVetoText(EntryNo: Integer): Text
    begin
        exit(StrSubstNo(SmallVetoErr, EntryNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Purge", 'OnBeforePurgeEntry', '', false, false)]
    local procedure VetoSmallEntry(Entry: Record "CGR Outbox Entry")
    begin
        if (VetoedEntryNo <> 0) and (Entry."Entry No." = VetoedEntryNo) then
            Error(SmallVetoErr, Entry."Entry No.");
    end;
}
