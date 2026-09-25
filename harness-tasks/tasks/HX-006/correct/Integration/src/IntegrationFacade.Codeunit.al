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
        Payload: JsonObject;
        Sequence: Integer;
    begin
        Sequence := NextSequence(VehicleNo);
        Payload.Add('event', 'vehicleCheckedOut');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.Add('sequence', Sequence);
        Queue('vehicleCheckedOut', VehicleNo, Sequence, Payload);
    end;

    procedure QueueVehicleReturned(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Payload: JsonObject;
        Sequence: Integer;
    begin
        Sequence := NextSequence(VehicleNo);
        Payload.Add('event', 'vehicleReturned');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.Add('returnKm', ReturnKm);
        Payload.Add('damage', DamageDescription <> '');
        if DamageDescription <> '' then
            Payload.Add('damageDescription', DamageDescription);
        Payload.Add('sequence', Sequence);
        Queue('vehicleReturned', VehicleNo, Sequence, Payload);
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

    local procedure Queue(EventType: Text[50]; VehicleNo: Code[20]; Sequence: Integer; Payload: JsonObject)
    var
        Entry: Record "CGR Outbox Entry";
        PayloadText: Text;
    begin
        Payload.WriteTo(PayloadText);
        Entry.Init();
        Entry."Event Type" := EventType;
        Entry."Vehicle No." := VehicleNo;
        Entry."Vehicle Sequence No." := Sequence;
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;

    local procedure NextSequence(VehicleNo: Code[20]): Integer
    var
        Seq: Record "CGR Vehicle Message Seq.";
    begin
        if not Seq.Get(VehicleNo) then begin
            Seq.Init();
            Seq."Vehicle No." := VehicleNo;
            Seq.Insert();
        end;
        Seq."Last Sequence No." += 1;
        Seq.Modify();
        exit(Seq."Last Sequence No.");
    end;
}
