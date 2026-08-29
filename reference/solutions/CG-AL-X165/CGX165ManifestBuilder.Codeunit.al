codeunit 71495 "CG X165 Manifest Builder"
{
    procedure BuildManifest(CarrierCode: Code[20]; var ManifestRow: Record "CG X165 Manifest Row" temporary)
    var
        Shipment: Record "CG X165 Shipment";
        ShipmentLine: Record "CG X165 Shipment Line";
        Carrier: Record "CG X165 Carrier";
        ShipmentOrder: List of [Code[20]];
        ShipmentRoute: Dictionary of [Code[20], Code[20]];
        ShipmentPriority: Dictionary of [Code[20], Integer];
        LineCountPerShipment: Dictionary of [Code[20], Integer];
        WeightPerShipment: Dictionary of [Code[20], Decimal];
        FreightPerShipment: Dictionary of [Code[20], Decimal];
        RowNo: Integer;
        CarrierDisplay: Text[100];
        SurchargePct: Decimal;
        ShipmentNo: Code[20];
    begin
        ManifestRow.Reset();
        ManifestRow.DeleteAll();
        RowNo := 0;

        if Carrier.Get(CarrierCode) then begin
            CarrierDisplay := Carrier."Display Name";
            SurchargePct := Carrier."Surcharge Pct";
        end;

        Shipment.SetRange("Carrier Code", CarrierCode);
        if Shipment.FindSet() then
            repeat
                ShipmentOrder.Add(Shipment."No.");
                ShipmentRoute.Add(Shipment."No.", Shipment."Route Code");
                ShipmentPriority.Add(Shipment."No.", Shipment.Priority);
                LineCountPerShipment.Add(Shipment."No.", 0);
                WeightPerShipment.Add(Shipment."No.", 0);
                FreightPerShipment.Add(Shipment."No.", 0);
            until Shipment.Next() = 0;

        ShipmentLine.Reset();
        if ShipmentLine.FindSet() then
            repeat
                ShipmentNo := ShipmentLine."Shipment No.";
                if LineCountPerShipment.ContainsKey(ShipmentNo) then begin
                    LineCountPerShipment.Set(ShipmentNo, LineCountPerShipment.Get(ShipmentNo) + 1);
                    WeightPerShipment.Set(ShipmentNo, WeightPerShipment.Get(ShipmentNo) + ShipmentLine.Weight);
                    FreightPerShipment.Set(ShipmentNo, FreightPerShipment.Get(ShipmentNo) + ShipmentLine."Freight Amount");
                end;
            until ShipmentLine.Next() = 0;

        foreach ShipmentNo in ShipmentOrder do begin
            RowNo += 1;
            ManifestRow.Init();
            ManifestRow."Row No." := RowNo;
            ManifestRow."Row Kind" := ManifestRow."Row Kind"::Shipment;
            ManifestRow."Shipment No." := ShipmentNo;
            ManifestRow."Route Code" := ShipmentRoute.Get(ShipmentNo);
            ManifestRow."Carrier Display" := CarrierDisplay;
            ManifestRow."Route Display" := GetRouteDisplay(ShipmentRoute.Get(ShipmentNo));
            ManifestRow."Line Count" := LineCountPerShipment.Get(ShipmentNo);
            ManifestRow."Total Weight" := WeightPerShipment.Get(ShipmentNo);
            ManifestRow."Freight Total" := FreightPerShipment.Get(ShipmentNo) * (1 + SurchargePct / 100);
            ManifestRow.Priority := ShipmentPriority.Get(ShipmentNo);
            ManifestRow.Insert();
        end;

        BuildRouteSummaries(ManifestRow, RowNo);
    end;

    local procedure GetRouteDisplay(RouteCode: Code[20]): Text[100]
    var
        Route: Record "CG X165 Route";
    begin
        if Route.Get(RouteCode) then
            exit(Route."Display Name");
    end;

    local procedure BuildRouteSummaries(var ManifestRow: Record "CG X165 Manifest Row" temporary; var RowNo: Integer)
    var
        RouteAgg: Record "CG X165 Manifest Row" temporary;
        RouteCode: Code[20];
        AggRowNo: Integer;
    begin
        AggRowNo := 0;
        ManifestRow.Reset();
        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        if ManifestRow.FindSet() then
            repeat
                RouteCode := ManifestRow."Route Code";
                RouteAgg.SetRange("Row Kind", RouteAgg."Row Kind"::RouteTotal);
                RouteAgg.SetRange("Route Code", RouteCode);
                if not RouteAgg.FindFirst() then begin
                    AggRowNo += 1;
                    RouteAgg.Init();
                    RouteAgg."Row No." := AggRowNo;
                    RouteAgg."Row Kind" := RouteAgg."Row Kind"::RouteTotal;
                    RouteAgg."Route Code" := RouteCode;
                    RouteAgg.Insert();
                end;
                RouteAgg."Total Weight" += ManifestRow."Total Weight";
                RouteAgg."Freight Total" += ManifestRow."Freight Total";
                RouteAgg.Modify();
            until ManifestRow.Next() = 0;

        ManifestRow.Reset();
        RouteAgg.Reset();
        if RouteAgg.FindSet() then
            repeat
                RowNo += 1;
                ManifestRow.Init();
                ManifestRow."Row No." := RowNo;
                ManifestRow."Row Kind" := ManifestRow."Row Kind"::RouteTotal;
                ManifestRow."Route Code" := RouteAgg."Route Code";
                ManifestRow."Route Display" := GetRouteDisplay(RouteAgg."Route Code");
                ManifestRow."Total Weight" := RouteAgg."Total Weight";
                ManifestRow."Freight Total" := RouteAgg."Freight Total";
                ManifestRow.Insert();
            until RouteAgg.Next() = 0;
        ManifestRow.Reset();
    end;
}
