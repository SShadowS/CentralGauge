codeunit 71563 "CG X172 Shipping Allocator"
{
    /// <summary>
    /// Splits a production order's total units across its receiving
    /// warehouses in proportion to each warehouse's weight, storing each
    /// warehouse's share in its Unit Share and recording that warehouse's
    /// own Shipping Cost as its Unit Share times its Unit Cost. Then
    /// splits each warehouse's own Shipping Cost across that warehouse's
    /// departments in proportion to each department's weight, storing
    /// each department's share in its Cost Share, and marks the order as
    /// allocated.
    /// </summary>
    procedure AllocateOrder(OrderNo: Code[20])
    var
        ProductionOrder: Record "CG X172 Production Order";
        Warehouse: Record "CG X172 Warehouse";
        WarehouseWeightSum: Decimal;
    begin
        ProductionOrder.Get(OrderNo);

        Warehouse.SetRange("Order No.", OrderNo);
        WarehouseWeightSum := 0;
        if Warehouse.FindSet() then
            repeat
                WarehouseWeightSum += Warehouse.Weight;
            until Warehouse.Next() = 0;

        if WarehouseWeightSum = 0 then
            exit;

        AllocateWarehouseUnits(OrderNo, ProductionOrder."Total Units", WarehouseWeightSum);
        AllocateAllDepartments(OrderNo);

        ProductionOrder.Allocated := true;
        ProductionOrder.Modify();
    end;

    /// <summary>
    /// Returns the sum of the unit shares already recorded on an order,
    /// for reconciliation against the order's own total units.
    /// </summary>
    procedure GetAllocatedUnitTotal(OrderNo: Code[20]): Integer
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.SetRange("Order No.", OrderNo);
        Warehouse.CalcSums("Unit Share");
        exit(Warehouse."Unit Share");
    end;

    /// <summary>
    /// Returns the sum of the department cost shares already recorded
    /// under one warehouse of an order, for reconciliation against that
    /// warehouse's own recorded shipping cost.
    /// </summary>
    procedure GetWarehouseAllocatedCostTotal(OrderNo: Code[20]; WarehouseLineNo: Integer): Decimal
    var
        Department: Record "CG X172 Department";
    begin
        Department.SetRange("Order No.", OrderNo);
        Department.SetRange("Warehouse Line No.", WarehouseLineNo);
        Department.CalcSums("Cost Share");
        exit(Department."Cost Share");
    end;

    /// <summary>
    /// Returns the sum of every department cost share already recorded
    /// anywhere on an order, for reconciliation against the order's
    /// warehouses' combined shipping cost.
    /// </summary>
    procedure GetOrderAllocatedCostTotal(OrderNo: Code[20]): Decimal
    var
        Department: Record "CG X172 Department";
    begin
        Department.SetRange("Order No.", OrderNo);
        Department.CalcSums("Cost Share");
        exit(Department."Cost Share");
    end;

    // Floors every warehouse's exact share of the order's total units to
    // whole units, then hands out whatever the floors left on the table
    // one unit at a time to whichever not-yet-topped-up warehouse's exact
    // entitlement was rounded down by the most - so the warehouse unit
    // shares always sum to exactly the order's total units, whatever the
    // weights. Finally stamps each warehouse's own Shipping Cost from its
    // now-final Unit Share.
    local procedure AllocateWarehouseUnits(OrderNo: Code[20]; TotalUnits: Integer; WeightSum: Decimal)
    var
        Warehouse: Record "CG X172 Warehouse";
        Winner: Record "CG X172 Warehouse";
        ExactShare: Decimal;
        FloorShare: Integer;
        FloorSum: Integer;
        RemainingResidual: Integer;
        CandidateRemainder: Decimal;
        BestRemainder: Decimal;
        Found: Boolean;
    begin
        FloorSum := 0;
        Warehouse.SetRange("Order No.", OrderNo);
        if Warehouse.FindSet() then
            repeat
                if Warehouse.Weight = 0 then
                    FloorShare := 0
                else
                    FloorShare := Round(TotalUnits * Warehouse.Weight / WeightSum, 1, '<');
                Warehouse."Unit Share" := FloorShare;
                Warehouse.Modify();
                FloorSum += FloorShare;
            until Warehouse.Next() = 0;

        RemainingResidual := TotalUnits - FloorSum;
        while RemainingResidual > 0 do begin
            Found := false;
            Warehouse.SetRange("Order No.", OrderNo);
            if Warehouse.FindSet() then
                repeat
                    if Warehouse.Weight <> 0 then begin
                        ExactShare := TotalUnits * Warehouse.Weight / WeightSum;
                        FloorShare := Round(ExactShare, 1, '<');
                        if Warehouse."Unit Share" = FloorShare then begin
                            CandidateRemainder := ExactShare - FloorShare;
                            if (not Found) or (CandidateRemainder > BestRemainder) then begin
                                Winner := Warehouse;
                                BestRemainder := CandidateRemainder;
                                Found := true;
                            end;
                        end;
                    end;
                until Warehouse.Next() = 0;

            Winner."Unit Share" += 1;
            Winner.Modify();
            RemainingResidual -= 1;
        end;

        Warehouse.SetRange("Order No.", OrderNo);
        if Warehouse.FindSet() then
            repeat
                Warehouse."Shipping Cost" := Warehouse."Unit Share" * Warehouse."Unit Cost";
                Warehouse.Modify();
            until Warehouse.Next() = 0;
    end;

    local procedure AllocateAllDepartments(OrderNo: Code[20])
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.SetRange("Order No.", OrderNo);
        if Warehouse.FindSet() then
            repeat
                AllocateDepartmentsForWarehouse(OrderNo, Warehouse."Line No.", Warehouse."Shipping Cost");
            until Warehouse.Next() = 0;
    end;

    // Same largest-remainder distribution as AllocateWarehouseUnits,
    // applied one granularity finer within one warehouse: the department
    // cost shares under it always sum to exactly that warehouse's own
    // (already cent-exact) Shipping Cost.
    local procedure AllocateDepartmentsForWarehouse(OrderNo: Code[20]; WarehouseLineNo: Integer; ShippingCost: Decimal)
    var
        Department: Record "CG X172 Department";
        Winner: Record "CG X172 Department";
        DepartmentWeightSum: Decimal;
        ExactShare: Decimal;
        FloorShare: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        CandidateRemainder: Decimal;
        BestRemainder: Decimal;
        Found: Boolean;
    begin
        Department.SetRange("Order No.", OrderNo);
        Department.SetRange("Warehouse Line No.", WarehouseLineNo);
        DepartmentWeightSum := 0;
        if Department.FindSet() then
            repeat
                DepartmentWeightSum += Department.Weight;
            until Department.Next() = 0;

        if DepartmentWeightSum = 0 then
            exit;

        FloorSum := 0;
        Department.SetRange("Order No.", OrderNo);
        Department.SetRange("Warehouse Line No.", WarehouseLineNo);
        if Department.FindSet() then
            repeat
                if Department.Weight = 0 then
                    FloorShare := 0
                else
                    FloorShare := Round(ShippingCost * Department.Weight / DepartmentWeightSum, 0.01, '<');
                Department."Cost Share" := FloorShare;
                Department.Modify();
                FloorSum += FloorShare;
            until Department.Next() = 0;

        RemainingResidual := ShippingCost - FloorSum;
        while RemainingResidual >= 0.005 do begin
            Found := false;
            Department.SetRange("Order No.", OrderNo);
            Department.SetRange("Warehouse Line No.", WarehouseLineNo);
            if Department.FindSet() then
                repeat
                    if Department.Weight <> 0 then begin
                        ExactShare := ShippingCost * Department.Weight / DepartmentWeightSum;
                        FloorShare := Round(ExactShare, 0.01, '<');
                        if Department."Cost Share" = FloorShare then begin
                            CandidateRemainder := ExactShare - FloorShare;
                            if (not Found) or (CandidateRemainder > BestRemainder) then begin
                                Winner := Department;
                                BestRemainder := CandidateRemainder;
                                Found := true;
                            end;
                        end;
                    end;
                until Department.Next() = 0;

            Winner."Cost Share" += 0.01;
            Winner.Modify();
            RemainingResidual -= 0.01;
        end;
    end;
}
