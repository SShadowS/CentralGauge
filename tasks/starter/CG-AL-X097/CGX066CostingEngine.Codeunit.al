codeunit 70312 "CG X066 Costing Engine"
{
    // Recomputes the shipment costs for one item from its ledger entries and
    // stores one "CG X066 Shipment Cost" row per shipment entry.
    procedure CalculateShipmentCosts(ItemNo: Code[20])
    var
        LedgerEntry: Record "CG X066 Ledger Entry";
        ShipmentCost: Record "CG X066 Shipment Cost";
        LayerQty: List of [Decimal];
        LayerUnitCost: List of [Decimal];
        OldestLayer: Integer;
        OnHand: Decimal;
        Needed: Decimal;
        Take: Decimal;
        RunningCost: Decimal;
    begin
        ShipmentCost.SetRange("Item No.", ItemNo);
        ShipmentCost.DeleteAll();

        LedgerEntry.SetCurrentKey("Item No.", "Entry No.");
        LedgerEntry.SetRange("Item No.", ItemNo);
        if not LedgerEntry.FindSet() then
            exit;

        OldestLayer := 1;
        repeat
            if LedgerEntry.Quantity > 0 then begin
                // A receipt opens a new cost layer at the back of the queue.
                LayerQty.Add(LedgerEntry.Quantity);
                LayerUnitCost.Add(LedgerEntry."Unit Cost");
                OnHand += LedgerEntry.Quantity;
            end else begin
                Needed := -LedgerEntry.Quantity;
                if Needed > OnHand then
                    Error('Insufficient inventory: cannot ship %1 units of %2, only %3 on hand.', Needed, ItemNo, OnHand);

                RunningCost := 0;
                while Needed > 0 do
                    if LayerQty.Get(OldestLayer) = 0 then
                        OldestLayer += 1
                    else begin
                        Take := LayerQty.Get(OldestLayer);
                        if Take > Needed then
                            Take := Needed;
                        RunningCost += Take * LayerUnitCost.Get(OldestLayer);
                        LayerQty.Set(OldestLayer, LayerQty.Get(OldestLayer) - Take);
                        Needed -= Take;
                    end;
                OnHand += LedgerEntry.Quantity;

                ShipmentCost.Init();
                ShipmentCost."Ledger Entry No." := LedgerEntry."Entry No.";
                ShipmentCost."Item No." := ItemNo;
                ShipmentCost."Posting Date" := LedgerEntry."Posting Date";
                ShipmentCost."Shipment Cost" := Round(RunningCost, 0.01);
                ShipmentCost.Insert();
            end;
        until LedgerEntry.Next() = 0;
    end;
}
