codeunit 70454 "CG X080 Shipment Status Sync"
{
    // Called by the carrier polling job with the shipment number and the
    // latest wire status code returned by the carrier's tracking API.
    procedure UpdateStatus(ShipmentNo: Code[20]; WireCode: Integer)
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
        CarrierStatusMapper: Codeunit "CG X080 Carrier Status Mapper";
    begin
        if not ShipmentTracking.Get(ShipmentNo) then begin
            ShipmentTracking.Init();
            ShipmentTracking."No." := ShipmentNo;
            ShipmentTracking.Insert();
        end;

        ShipmentTracking."Carrier Wire Code" := WireCode;
        ShipmentTracking.Status := CarrierStatusMapper.FromWire(WireCode);
        ShipmentTracking."Last Synced At" := CurrentDateTime();
        ShipmentTracking.Modify();
    end;
}
