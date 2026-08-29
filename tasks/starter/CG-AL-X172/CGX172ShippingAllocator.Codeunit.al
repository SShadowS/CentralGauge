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
        Department: Record "CG X172 Department";
        WarehouseWeightSum: Decimal;
        DepartmentWeightSum: Decimal;
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

        // Distribute the order's total units across warehouses in
        // proportion to each warehouse's share of the total weight,
        // rounded to the nearest whole unit.
        if Warehouse.FindSet() then
            repeat
                if Warehouse.Weight = 0 then
                    Warehouse."Unit Share" := 0
                else
                    Warehouse."Unit Share" := Round(ProductionOrder."Total Units" * Warehouse.Weight / WarehouseWeightSum, 1);
                Warehouse.Modify();
            until Warehouse.Next() = 0;

        // Now spread each warehouse's own (already-rounded) shipping cost
        // across its receiving departments, the same way.
        Warehouse.SetRange("Order No.", OrderNo);
        if Warehouse.FindSet() then
            repeat
                Warehouse."Shipping Cost" := Warehouse."Unit Share" * Warehouse."Unit Cost";
                Warehouse.Modify();

                Department.SetRange("Order No.", OrderNo);
                Department.SetRange("Warehouse Line No.", Warehouse."Line No.");
                DepartmentWeightSum := 0;
                if Department.FindSet() then
                    repeat
                        DepartmentWeightSum += Department.Weight;
                    until Department.Next() = 0;

                if DepartmentWeightSum <> 0 then
                    if Department.FindSet() then
                        repeat
                            Department."Cost Share" := Round(Warehouse."Shipping Cost" * Department.Weight / DepartmentWeightSum, 0.01);
                            Department.Modify();
                        until Department.Next() = 0;
            until Warehouse.Next() = 0;

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
}
