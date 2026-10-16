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
        Entry.Init();
        Entry."Event Type" := 'vehicleCheckedOut';
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(VehicleCheckedOutPayload(VehicleNo), 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
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

    procedure PurgeSentEntries(var EntryFilter: Record "CGR Outbox Entry"; ChunkSize: Integer): Integer
    var
        Entry: Record "CGR Outbox Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
        Purged: Integer;
    begin
        Entry.CopyFilters(EntryFilter);
        Entry.SetRange(Sent, true);
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;

        foreach EntryNo in EntryNos do begin
            Entry.Get(EntryNo);
            OnBeforePurgeEntry(Entry);
            Entry.Delete(true);
            Purged += 1;
            if ChunkSize > 0 then
                if Purged mod ChunkSize = 0 then
                    Commit();
        end;
        if Purged > 0 then
            Commit();
        exit(Purged);
    end;

    procedure PurgeSentForVehicle(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
        Purged: Integer;
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        if VehicleNo = '' then
            exit(PurgeSentEntries(Entry, 50));
        Entry.SetRange(Sent, true);
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;

        foreach EntryNo in EntryNos do begin
            Entry.Get(EntryNo);
            OnBeforePurgeEntry(Entry);
            Entry.Delete(true);
            Purged += 1;
            if (Purged mod 50 = 0) or (Purged = EntryNos.Count()) then
                Commit();
        end;
        exit(Purged);
    end;

    procedure PurgeSentBefore(CreatedBefore: DateTime): Integer
    var
        Entry: Record "CGR Outbox Entry";
        EntryNos: List of [Integer];
        EntryNo: Integer;
        Purged: Integer;
    begin
        Entry.SetFilter("Created At", '<%1', CreatedBefore);
        if CreatedBefore = 0DT then
            exit(PurgeSentEntries(Entry, 50));
        Entry.SetRange(Sent, true);
        if Entry.FindSet() then
            repeat
                EntryNos.Add(Entry."Entry No.");
            until Entry.Next() = 0;

        foreach EntryNo in EntryNos do begin
            Entry.Get(EntryNo);
            OnBeforePurgeEntry(Entry);
            Entry.Delete(true);
            Purged += 1;
            if (Purged mod 50 = 0) or (Purged = EntryNos.Count()) then
                Commit();
        end;
        exit(Purged);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforePurgeEntry(Entry: Record "CGR Outbox Entry")
    begin
    end;
}
