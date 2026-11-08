codeunit 80541 "CGR Redelivery Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedEntryNo: Integer;
        PartnerRefusedErr: Label 'Partner app refused outbox entry %1.', Comment = '%1 = entry number';

    procedure RefuseRedeliveryOf(EntryNo: Integer)
    begin
        RefusedEntryNo := EntryNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Redelivery Send", 'OnRedeliverEntry', '', false, false)]
    local procedure RefuseOneEntry(Entry: Record "CGR Outbox Entry")
    begin
        if (RefusedEntryNo <> 0) and (Entry."Entry No." = RefusedEntryNo) then
            Error(PartnerRefusedErr, Entry."Entry No.");
    end;
}
