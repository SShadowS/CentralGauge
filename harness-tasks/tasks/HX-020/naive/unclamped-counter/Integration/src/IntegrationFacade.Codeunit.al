codeunit 70400 "CGR Integration Facade"
{
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
        if QueueingSuspended() then
            exit;
        Entry.Init();
        Entry."Event Type" := 'vehicleCheckedOut';
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(VehicleCheckedOutPayload(VehicleNo), 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;

    procedure SuspendQueueing()
    var
        QueueState: Codeunit "CGR Outbox Queue State";
    begin
        QueueState.AddSuspension();
    end;

    procedure ResumeQueueing()
    var
        QueueState: Codeunit "CGR Outbox Queue State";
    begin
        QueueState.RemoveSuspension();
    end;

    procedure QueueingSuspended(): Boolean
    var
        QueueState: Codeunit "CGR Outbox Queue State";
    begin
        exit(QueueState.HasSuspension());
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
}
