codeunit 70418 "CGR Outbox Batcher"
{
    procedure QueueVehicleBatch(VehicleNos: List of [Code[20]]): Integer
    var
        Chunks: List of [List of [Code[20]]];
        Chunk: List of [Code[20]];
        VehicleNo: Code[20];
        Queued: Integer;
    begin
        foreach VehicleNo in VehicleNos do begin
            Chunk.Add(VehicleNo);
            if Chunk.Count() = 3 then begin
                Chunks.Add(Chunk);
                while Chunk.Count() > 0 do
                    Chunk.RemoveAt(1);
            end;
        end;
        if Chunk.Count() > 0 then
            Chunks.Add(Chunk);

        foreach Chunk in Chunks do begin
            QueueChunk(Chunk);
            Queued += 1;
        end;
        exit(Queued);
    end;

    local procedure QueueChunk(Chunk: List of [Code[20]])
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        Nos: JsonArray;
        VehicleNo: Code[20];
        PayloadText: Text;
    begin
        foreach VehicleNo in Chunk do
            Nos.Add(VehicleNo);
        Payload.Add('event', 'vehicleBatch');
        Payload.Add('vehicleNos', Nos);
        Payload.WriteTo(PayloadText);

        Entry.Init();
        Entry."Event Type" := 'vehicleBatch';
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;
}
