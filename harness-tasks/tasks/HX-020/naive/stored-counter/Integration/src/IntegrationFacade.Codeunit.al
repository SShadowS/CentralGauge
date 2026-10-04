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
        QueuePause: Record "CGR Outbox Queue Pause";
    begin
        if not QueuePause.Get() then begin
            QueuePause.Init();
            QueuePause.Insert();
        end;
        QueuePause."Suspension Count" += 1;
        QueuePause.Modify();
    end;

    procedure ResumeQueueing()
    var
        QueuePause: Record "CGR Outbox Queue Pause";
    begin
        if not QueuePause.Get() then
            exit;
        if QueuePause."Suspension Count" <= 0 then
            exit;
        QueuePause."Suspension Count" -= 1;
        QueuePause.Modify();
    end;

    procedure QueueingSuspended(): Boolean
    var
        QueuePause: Record "CGR Outbox Queue Pause";
    begin
        if not QueuePause.Get() then
            exit(false);
        exit(QueuePause."Suspension Count" > 0);
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
