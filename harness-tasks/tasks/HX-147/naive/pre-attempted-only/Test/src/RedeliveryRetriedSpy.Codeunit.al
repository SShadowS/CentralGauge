codeunit 80548 "CGR Redelivery Retried Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedEntryNo: Integer;

    procedure RefuseRetriedEntry(EntryNo: Integer)
    begin
        RefusedEntryNo := EntryNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Redelivery Send", 'OnRedeliverEntry', '', false, false)]
    local procedure RefuseRetried(Entry: Record "CGR Outbox Entry")
    begin
        if (RefusedEntryNo <> 0) and (Entry."Entry No." = RefusedEntryNo) then
            Error('Partner refused entry %1.', Entry."Entry No.");
    end;
}
