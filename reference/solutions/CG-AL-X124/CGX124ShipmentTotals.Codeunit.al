codeunit 70842 "CG X124 Shipment Totals"
{
    /// Brings a shipment's stored totals back in step with its lines.
    procedure Recalculate(ShipmentNo: Code[20])
    var
        Header: Record "CG X124 Shipment Header";
        Line: Record "CG X124 Shipment Line";
        RunningWeight: Decimal;
        RunningCount: Integer;
    begin
        if not Header.Get(ShipmentNo) then
            Error(MissingShipmentErr, ShipmentNo);

        Line.SetRange("Shipment No.", ShipmentNo);
        if Line.FindSet() then
            repeat
                RunningWeight := RunningWeight + Line.Weight;
                RunningCount := RunningCount + 1;
            until Line.Next() = 0;

        Header."Total Weight" := RunningWeight;
        Header."Line Count" := RunningCount;
        Header.Modify();
    end;

    procedure TotalWeightOf(ShipmentNo: Code[20]): Decimal
    var
        Header: Record "CG X124 Shipment Header";
    begin
        if not Header.Get(ShipmentNo) then
            Error(MissingShipmentErr, ShipmentNo);
        exit(Header."Total Weight");
    end;

    procedure LineCountOf(ShipmentNo: Code[20]): Integer
    var
        Header: Record "CG X124 Shipment Header";
    begin
        if not Header.Get(ShipmentNo) then
            Error(MissingShipmentErr, ShipmentNo);
        exit(Header."Line Count");
    end;

    var
        MissingShipmentErr: Label 'Shipment %1 does not exist.', Comment = '%1 = shipment number';
}
