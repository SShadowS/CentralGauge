codeunit 70400 "CGR Integration Facade"
{
    var
        CorrelationSeqTok: Label 'CGR-OUTBOX-CORRELATION', Locked = true;

    procedure VehicleCheckedOutPayload(VehicleNo: Code[20]): Text
    var
        Payload: JsonObject;
        Result: Text;
    begin
        Payload.Add('event', 'vehicleCheckedOut');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.WriteTo(Result);
        exit(Result);
    end;

    procedure QueueVehicleCheckedOut(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Event Type" := 'vehicleCheckedOut';
        Entry."Vehicle No." := VehicleNo;
        Entry."Correlation No." := NextCorrelationNo();
        Entry.Payload := CopyStr(VehicleCheckedOutPayload(VehicleNo), 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
        OnAfterQueueEntry(Entry);
    end;

    procedure MarkSent(EntryNo: Integer)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Get(EntryNo);
        Entry.Sent := true;
        Entry.Modify(true);
    end;

    procedure PurgeSent()
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange(Sent, true);
        Entry.DeleteAll(true);
    end;

    local procedure NextCorrelationNo(): BigInteger
    begin
        if not NumberSequence.Exists(CorrelationSeqTok) then
            NumberSequence.Insert(CorrelationSeqTok, 1, 1);
        exit(NumberSequence.Next(CorrelationSeqTok));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterQueueEntry(var Entry: Record "CGR Outbox Entry")
    begin
    end;
}
