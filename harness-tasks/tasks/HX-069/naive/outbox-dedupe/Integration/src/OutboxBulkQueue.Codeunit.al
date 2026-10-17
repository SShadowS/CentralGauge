codeunit 70420 "CGR Outbox Bulk Queue"
{
    procedure QueueCheckedOutVehicles(VehicleNos: List of [Code[20]]): Integer
    var
        Queued: Integer;
        VehicleNo: Code[20];
    begin
        foreach VehicleNo in VehicleNos do
            if VehicleNo <> '' then
                if not IsQueued(VehicleNo) then begin
                    QueueVehicle(VehicleNo);
                    Queued += 1;
                end;
        exit(Queued);
    end;

    local procedure IsQueued(VehicleNo: Code[20]): Boolean
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        exit(not Entry.IsEmpty());
    end;

    local procedure QueueVehicle(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Entry.Init();
        Entry."Event Type" := 'vehicleCheckedOut';
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(Facade.VehicleCheckedOutPayload(VehicleNo), 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;
}
