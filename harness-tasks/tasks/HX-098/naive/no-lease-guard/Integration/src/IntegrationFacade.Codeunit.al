codeunit 70400 "CGR Integration Facade"
{
    procedure VehicleCheckedOutPayload(VehicleNo: Code[20]): Text
    var
        Vehicle: Record "CGR Vehicle";
        Payload: JsonObject;
        Result: Text;
    begin
        Payload.Add('event', 'vehicleCheckedOut');
        Payload.Add('vehicleNo', VehicleNo);
        if Vehicle.Get(VehicleNo) then
            Payload.Add('assetType', AssetTypeCode(Vehicle."Asset Type"));
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

    local procedure AssetTypeCode(AssetType: Enum "CGR Asset Type"): Text
    begin
        case AssetType of
            AssetType::Car:
                exit('car');
            AssetType::Van:
                exit('van');
            AssetType::Boat:
                exit('boat');
        end;
    end;
}
