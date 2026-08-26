codeunit 70842 "CG X124 Shipment Totals"
{
    /// Brings a shipment's stored totals back in step with its lines.
    procedure Recalculate(ShipmentNo: Code[20])
    var
        Header: Record "CG X124 Shipment Header";
        Line: Record "CG X124 Shipment Line";
    begin
        if not Header.Get(ShipmentNo) then
            Error(MissingShipmentErr, ShipmentNo);

        Header."Total Weight" := 0;
        Header."Line Count" := 0;
        Header.Modify();

        Line.SetRange("Shipment No.", ShipmentNo);
        if Line.FindSet() then
            repeat
                Header.Get(ShipmentNo);
                Header."Total Weight" := Header."Total Weight" + Line.Weight;
                Header."Line Count" := Header."Line Count" + 1;
                Header.Modify();
            until Line.Next() = 0;
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
