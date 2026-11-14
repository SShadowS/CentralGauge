codeunit 70440 "CGR Contract Deletion Feed"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Contract Housekeeping", 'OnAfterBookingCancelled', '', false, false)]
    local procedure QueueContractDeleted(var Contract: Record "CGR Rental Contract")
    begin
        QueueEntry(Contract);
    end;

    local procedure QueueEntry(Contract: Record "CGR Rental Contract")
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        PayloadText: Text;
    begin
        Payload.Add('event', 'contractDeleted');
        Payload.Add('contractNo', Contract."No.");
        Payload.Add('vehicleNo', Contract."Vehicle No.");
        Payload.WriteTo(PayloadText);
        Entry.Init();
        Entry."Event Type" := 'contractDeleted';
        Entry."Vehicle No." := Contract."Vehicle No.";
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;
}
