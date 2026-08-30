codeunit 71591 "CG X176 Restatement Run"
{
    // Restates one shipment's recorded cost: recomputes its current Shipment
    // Cost from the costing engine, compares that to the cost recorded the
    // previous time this shipment was restated (zero the first time), and
    // posts the exact difference as a Transfer adjustment line moving value
    // from the WIP location to the COGS location for the shipment's item.
    procedure RestateShipment(ShipmentLedgerEntryNo: Integer; WipLocationCode: Code[10]; CogsLocationCode: Code[10])
    var
        ShipmentLedgerEntry: Record "CG X066 Ledger Entry";
        ShipmentCost: Record "CG X066 Shipment Cost";
        Restatement: Record "CG X176 Restatement";
        AdjLine: Record "CG X139 Adjustment Line";
        Engine: Codeunit "CG X066 Costing Engine";
        Poster: Codeunit "CG X139 Adjustment Poster";
        DocumentNo: Code[20];
        PriorCost: Decimal;
        RestatedCost: Decimal;
        Delta: Decimal;
        Counter: Integer;
    begin
        ShipmentLedgerEntry.Get(ShipmentLedgerEntryNo);

        Engine.CalculateShipmentCosts(ShipmentLedgerEntry."Item No.");

        ShipmentCost.Get(ShipmentLedgerEntryNo);
        RestatedCost := ShipmentCost."Shipment Cost";

        if Restatement.Get(ShipmentLedgerEntryNo) then begin
            PriorCost := Restatement."Restated Cost";
            Counter := Restatement."Restate Counter" + 1;
        end else begin
            PriorCost := 0;
            Counter := 1;
            Restatement.Init();
            Restatement."Ledger Entry No." := ShipmentLedgerEntryNo;
            Restatement.Insert();
        end;

        Delta := RestatedCost - PriorCost;

        DocumentNo := StrSubstNo('RST%1-%2', ShipmentLedgerEntryNo, Counter);
        AdjLine.Init();
        AdjLine."Document No." := DocumentNo;
        AdjLine."Line No." := 1;
        AdjLine."Adjustment Type" := "CG X139 Adjustment Type"::Transfer;
        AdjLine."Item No." := ShipmentLedgerEntry."Item No.";
        AdjLine."Location Code" := WipLocationCode;
        AdjLine."New Location Code" := CogsLocationCode;
        AdjLine.Quantity := Delta;
        AdjLine.Insert();

        Poster.PostAdjustments(DocumentNo);

        Restatement."Item No." := ShipmentLedgerEntry."Item No.";
        Restatement."Prior Cost" := PriorCost;
        Restatement."Restated Cost" := RestatedCost;
        Restatement."Cost Delta" := Delta;
        Restatement."Restate Counter" := Counter;
        Restatement.Modify();
    end;
}
