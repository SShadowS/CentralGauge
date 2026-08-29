codeunit 71495 "CG X165 Manifest Builder"
{
    procedure BuildManifest(CarrierCode: Code[20]; var ManifestRow: Record "CG X165 Manifest Row" temporary)
    var
        Shipment: Record "CG X165 Shipment";
        Carrier: Record "CG X165 Carrier";
        RowNo: Integer;
        CarrierDisplay: Text[100];
        SurchargePct: Decimal;
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
                RowNo += 1;
                ManifestRow.Init();
                ManifestRow."Row No." := RowNo;
                ManifestRow."Row Kind" := ManifestRow."Row Kind"::Shipment;
                ManifestRow."Shipment No." := Shipment."No.";
                ManifestRow."Route Code" := Shipment."Route Code";
                ManifestRow."Carrier Display" := CarrierDisplay;
                ManifestRow."Route Display" := GetRouteDisplay(Shipment."Route Code");
                ManifestRow."Line Count" := GetShipmentLineCount(Shipment."No.");
                ManifestRow."Total Weight" := GetShipmentTotalWeight(Shipment."No.");
                ManifestRow."Freight Total" := GetShipmentTotalFreight(Shipment."No.", SurchargePct);
                ManifestRow.Priority := Shipment.Priority;
                ManifestRow.Insert();
            until Shipment.Next() = 0;

        BuildRouteSummaries(ManifestRow, RowNo);
    end;

    local procedure GetRouteDisplay(RouteCode: Code[20]): Text[100]
    var
        Route: Record "CG X165 Route";
    begin
        if Route.Get(RouteCode) then
            exit(Route."Display Name");
    end;

    local procedure GetShipmentLineCount(ShipmentNo: Code[20]): Integer
    var
        ShipmentLine: Record "CG X165 Shipment Line";
    begin
        ShipmentLine.SetRange("Shipment No.", ShipmentNo);
        exit(ShipmentLine.Count());
    end;

    local procedure GetShipmentTotalWeight(ShipmentNo: Code[20]): Decimal
    var
        ShipmentLine: Record "CG X165 Shipment Line";
        TotalWeight: Decimal;
    begin
        ShipmentLine.SetRange("Shipment No.", ShipmentNo);
        if ShipmentLine.FindSet() then
            repeat
                TotalWeight += ShipmentLine.Weight;
            until ShipmentLine.Next() = 0;
        exit(TotalWeight);
    end;

    local procedure GetShipmentTotalFreight(ShipmentNo: Code[20]; SurchargePct: Decimal): Decimal
    var
        ShipmentLine: Record "CG X165 Shipment Line";
        TotalFreight: Decimal;
    begin
        ShipmentLine.SetRange("Shipment No.", ShipmentNo);
        if ShipmentLine.FindSet() then
            repeat
                TotalFreight += ShipmentLine."Freight Amount";
            until ShipmentLine.Next() = 0;
        exit(TotalFreight * (1 + SurchargePct / 100));
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
