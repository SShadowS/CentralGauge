codeunit 86582 "HX056 Queue Runner"
{
    var
        QueueVehicleNo: Code[20];
        InsertMarker: Boolean;

    procedure Configure(VehicleNo: Code[20]; WithMarker: Boolean)
    begin
        QueueVehicleNo := VehicleNo;
        InsertMarker := WithMarker;
    end;

    trigger OnRun()
    var
        Marker: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        if InsertMarker then begin
            Marker.Init();
            Marker."Event Type" := 'hx056Marker';
            Marker."Vehicle No." := 'HX056-MARK';
            Marker.Payload := '{"event":"hx056Marker"}';
            Marker."Created At" := CurrentDateTime();
            Marker.Insert(true);
        end;
        Facade.QueueVehicleCheckedOut(QueueVehicleNo);
    end;
}
