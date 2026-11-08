codeunit 80544 "CGR Redelivery Far Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedEntryNo: Integer;

    procedure RefuseFarEntry(EntryNo: Integer)
    begin
        RefusedEntryNo := EntryNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Redelivery Send", 'OnRedeliverEntry', '', false, false)]
    local procedure RefuseFar(Entry: Record "CGR Outbox Entry")
    begin
        if (RefusedEntryNo <> 0) and (Entry."Entry No." = RefusedEntryNo) then
            Error('Partner refused entry %1.', Entry."Entry No.");
    end;
}
