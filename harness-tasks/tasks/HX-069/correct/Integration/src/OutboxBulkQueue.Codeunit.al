codeunit 70420 "CGR Outbox Bulk Queue"
{
    procedure QueueCheckedOutVehicles(VehicleNos: List of [Code[20]]): Integer
    var
        Staged: Record "CGR Outbox Entry" temporary;
        Facade: Codeunit "CGR Integration Facade";
        VehicleNo: Code[20];
        Queued: Integer;
        StagedNo: Integer;
    begin
        foreach VehicleNo in VehicleNos do
            if VehicleNo <> '' then begin
                Staged.SetRange("Vehicle No.", VehicleNo);
                if Staged.IsEmpty() then begin
                    StagedNo += 1;
                    Staged.Init();
                    Staged."Entry No." := StagedNo;
                    Staged."Event Type" := 'vehicleCheckedOut';
                    Staged."Vehicle No." := VehicleNo;
                    Staged.Payload := CopyStr(Facade.VehicleCheckedOutPayload(VehicleNo), 1, MaxStrLen(Staged.Payload));
                    Staged."Created At" := CurrentDateTime();
                    Staged.Insert();
                end;
            end;

        Staged.Reset();
        if Staged.FindSet() then
            repeat
                QueueStaged(Staged);
                Queued += 1;
            until Staged.Next() = 0;
        exit(Queued);
    end;

    local procedure QueueStaged(Staged: Record "CGR Outbox Entry" temporary)
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.Init();
        Entry."Event Type" := Staged."Event Type";
        Entry."Vehicle No." := Staged."Vehicle No.";
        Entry.Payload := Staged.Payload;
        Entry."Created At" := Staged."Created At";
        Entry.Insert(true);
    end;
}
