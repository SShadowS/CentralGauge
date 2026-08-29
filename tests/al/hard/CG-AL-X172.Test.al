codeunit 89392 "CG-AL-X172 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears all three
    // tables before seeding its own rows.

    local procedure ClearAllData()
    var
        Department: Record "CG X172 Department";
        Warehouse: Record "CG X172 Warehouse";
        ProductionOrder: Record "CG X172 Production Order";
    begin
        Department.DeleteAll();
        Warehouse.DeleteAll();
        ProductionOrder.DeleteAll();
    end;

    local procedure SeedOrder(OrderNo: Code[20]; TotalUnits: Integer)
    var
        ProductionOrder: Record "CG X172 Production Order";
    begin
        ProductionOrder.Init();
        ProductionOrder."No." := OrderNo;
        ProductionOrder."Order Description" := 'Test order';
        ProductionOrder."Total Units" := TotalUnits;
        ProductionOrder.Insert();
    end;

    local procedure SeedWarehouse(OrderNo: Code[20]; LineNo: Integer; WarehouseName: Text[100]; WarehouseWeight: Decimal; UnitCost: Decimal)
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.Init();
        Warehouse."Order No." := OrderNo;
        Warehouse."Line No." := LineNo;
        Warehouse."Warehouse Name" := WarehouseName;
        Warehouse.Weight := WarehouseWeight;
        Warehouse."Unit Cost" := UnitCost;
        Warehouse.Insert();
    end;

    local procedure SeedWarehouseWithSentinel(OrderNo: Code[20]; LineNo: Integer; WarehouseName: Text[100]; WarehouseWeight: Decimal; UnitCost: Decimal; SentinelUnitShare: Integer; SentinelShippingCost: Decimal)
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.Init();
        Warehouse."Order No." := OrderNo;
        Warehouse."Line No." := LineNo;
        Warehouse."Warehouse Name" := WarehouseName;
        Warehouse.Weight := WarehouseWeight;
        Warehouse."Unit Cost" := UnitCost;
        Warehouse."Unit Share" := SentinelUnitShare;
        Warehouse."Shipping Cost" := SentinelShippingCost;
        Warehouse.Insert();
    end;

    local procedure SeedDepartment(OrderNo: Code[20]; WarehouseLineNo: Integer; DepartmentLineNo: Integer; DepartmentName: Text[100]; DepartmentWeight: Decimal)
    var
        Department: Record "CG X172 Department";
    begin
        Department.Init();
        Department."Order No." := OrderNo;
        Department."Warehouse Line No." := WarehouseLineNo;
        Department."Department Line No." := DepartmentLineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DepartmentWeight;
        Department.Insert();
    end;

    local procedure SeedDepartmentWithSentinel(OrderNo: Code[20]; WarehouseLineNo: Integer; DepartmentLineNo: Integer; DepartmentName: Text[100]; DepartmentWeight: Decimal; SentinelCostShare: Decimal)
    var
        Department: Record "CG X172 Department";
    begin
        Department.Init();
        Department."Order No." := OrderNo;
        Department."Warehouse Line No." := WarehouseLineNo;
        Department."Department Line No." := DepartmentLineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DepartmentWeight;
        Department."Cost Share" := SentinelCostShare;
        Department.Insert();
    end;

    local procedure GetUnitShare(OrderNo: Code[20]; LineNo: Integer): Integer
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.Get(OrderNo, LineNo);
        exit(Warehouse."Unit Share");
    end;

    local procedure GetShippingCost(OrderNo: Code[20]; LineNo: Integer): Decimal
    var
        Warehouse: Record "CG X172 Warehouse";
    begin
        Warehouse.Get(OrderNo, LineNo);
        exit(Warehouse."Shipping Cost");
    end;

    local procedure GetCostShare(OrderNo: Code[20]; WarehouseLineNo: Integer; DepartmentLineNo: Integer): Decimal
    var
        Department: Record "CG X172 Department";
    begin
        Department.Get(OrderNo, WarehouseLineNo, DepartmentLineNo);
        exit(Department."Cost Share");
    end;

    // Independently reconstructs the level-1 allocation every correct
    // implementation must produce: floor everyone's exact proportional
    // share of the order's total units, then hand out whatever the
    // floors left on the table one whole unit at a time to whichever
    // warehouse's exact entitlement was rounded down by the most,
    // tie-broken by the lower array index (which every caller below
    // populates in ascending line-number order). A zero-weight
    // warehouse's remainder is always exactly zero, so it never competes
    // for a leftover unit. This mirrors the allocator's own fix - it is
    // the definition of "correct" this oracle grades against, not a
    // re-implementation that happens to agree with one particular
    // solution.
    local procedure ComputeIntegerLevelShares(Weight: array[10] of Decimal; ItemCount: Integer; TotalUnits: Integer; var ExpectedShare: array[10] of Integer)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Integer;
        RemainingResidual: Integer;
        ExactShare: Decimal;
        FloorShare: Integer;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to ItemCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to ItemCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalUnits * Weight[i] / WeightSum;
                FloorShare := Round(ExactShare, 1, '<');
                ExpectedShare[i] := FloorShare;
                Remainder[i] := ExactShare - FloorShare;
                FloorSum += FloorShare;
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalUnits - FloorSum;
        while RemainingResidual > 0 do begin
            WinnerIndex := 0;
            for i := 1 to ItemCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" would index Remainder[0] on the
                    // first candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if Remainder[i] > Remainder[WinnerIndex] then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 1;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 1;
        end;
    end;

    // The level-2 counterpart of ComputeIntegerLevelShares: the same
    // floor-then-largest-remainder reference, but awarding leftover cents
    // instead of leftover whole units.
    local procedure ComputeCentLevelShares(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to ItemCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to ItemCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to ItemCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if Remainder[i] > Remainder[WinnerIndex] then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure SingleWarehouseSingleDepartmentGetsTheEntireOrder()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('SP01', 9);
        SeedWarehouse('SP01', 1, 'Solo Warehouse', 4, 12.34);
        SeedDepartment('SP01', 1, 1, 'Solo Department', 17);

        Allocator.AllocateOrder('SP01');

        Assert.AreEqual(9, GetUnitShare('SP01', 1), 'Expected an order with a single warehouse to allocate its entire total units to that warehouse');
        Assert.AreEqual(111.06, GetShippingCost('SP01', 1), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(111.06, GetCostShare('SP01', 1, 1), 'Expected a warehouse with a single department to allocate its entire shipping cost to that department');
    end;

    [Test]
    procedure CleanTwoWarehouseTwoDepartmentSplitReconcilesExactlyAndLeavesAnotherOrderUntouched()
    var
        ProductionOrder: Record "CG X172 Production Order";
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('CD01', 20);
        SeedWarehouse('CD01', 1, 'Warehouse East', 1, 2.50);
        SeedWarehouse('CD01', 2, 'Warehouse West', 1, 3.00);
        SeedDepartment('CD01', 1, 1, 'Dept A', 1);
        SeedDepartment('CD01', 1, 2, 'Dept B', 1);
        SeedDepartment('CD01', 2, 1, 'Dept C', 1);
        SeedDepartment('CD01', 2, 2, 'Dept D', 1);

        // A second, unrelated order is seeded with its own nonzero
        // sentinel values, at every level, and left alone - allocating
        // CD01 must not touch it.
        SeedOrder('XO01', 999);
        SeedWarehouseWithSentinel('XO01', 1, 'Warehouse Untouched', 1, 9.99, 11, 555.55);
        SeedDepartmentWithSentinel('XO01', 1, 1, 'Dept Untouched A', 1, 111.11);
        SeedDepartmentWithSentinel('XO01', 1, 2, 'Dept Untouched B', 1, 222.22);

        Allocator.AllocateOrder('CD01');

        Assert.AreEqual(10, GetUnitShare('CD01', 1), 'Expected an even two-warehouse split to allocate exactly half the total units to each warehouse');
        Assert.AreEqual(10, GetUnitShare('CD01', 2), 'Expected an even two-warehouse split to allocate exactly half the total units to each warehouse');
        Assert.AreEqual(25.00, GetShippingCost('CD01', 1), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(30.00, GetShippingCost('CD01', 2), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(12.50, GetCostShare('CD01', 1, 1), 'Expected an even two-department split to allocate exactly half the warehouse shipping cost to each department');
        Assert.AreEqual(12.50, GetCostShare('CD01', 1, 2), 'Expected an even two-department split to allocate exactly half the warehouse shipping cost to each department');
        Assert.AreEqual(15.00, GetCostShare('CD01', 2, 1), 'Expected an even two-department split to allocate exactly half the warehouse shipping cost to each department');
        Assert.AreEqual(15.00, GetCostShare('CD01', 2, 2), 'Expected an even two-department split to allocate exactly half the warehouse shipping cost to each department');
        Assert.AreEqual(20, Allocator.GetAllocatedUnitTotal('CD01'), 'Expected the order-level unit reconciliation total to equal the order''s total units after allocating');
        Assert.AreEqual(55.00, Allocator.GetOrderAllocatedCostTotal('CD01'), 'Expected the order-level cost reconciliation total to equal the combined shipping cost of every warehouse after allocating');
        Assert.AreEqual(25.00, Allocator.GetWarehouseAllocatedCostTotal('CD01', 1), 'Expected the departments under one warehouse to sum to that warehouse''s own recorded shipping cost, not every warehouse''s combined');
        Assert.AreEqual(30.00, Allocator.GetWarehouseAllocatedCostTotal('CD01', 2), 'Expected the departments under one warehouse to sum to that warehouse''s own recorded shipping cost, not every warehouse''s combined');

        ProductionOrder.Get('XO01');
        Assert.IsFalse(ProductionOrder.Allocated, 'Expected an untouched order to stay unallocated');
        Assert.AreEqual(11, GetUnitShare('XO01', 1), 'Expected another order''s unit share to be left untouched by allocating a different order');
        Assert.AreEqual(555.55, GetShippingCost('XO01', 1), 'Expected another order''s shipping cost to be left untouched by allocating a different order');
        Assert.AreEqual(111.11, GetCostShare('XO01', 1, 1), 'Expected another order''s department cost share to be left untouched by allocating a different order');
        Assert.AreEqual(222.22, GetCostShare('XO01', 1, 2), 'Expected another order''s department cost share to be left untouched by allocating a different order');
        // XO01's own departments (333.33) do not reconcile with its own
        // warehouse's shipping cost (555.55) by design - it was never
        // allocated. Pinning the reconciliation total against the
        // departments' own recorded amounts here, not the warehouse
        // field, catches a reconciliation procedure that just echoes
        // another field instead of reading the table it is supposed to.
        Assert.AreEqual(333.33, Allocator.GetWarehouseAllocatedCostTotal('XO01', 1), 'Expected the warehouse-level cost reconciliation total to reflect the warehouse''s own recorded department cost shares');
        Assert.AreEqual(333.33, Allocator.GetOrderAllocatedCostTotal('XO01'), 'Expected the order-level cost reconciliation total to reflect the order''s own recorded department cost shares');
    end;

    [Test]
    procedure AdversarialFourWarehouseUnitAllocationClosesExactlyToTheOrderedTotal()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        // Weights chosen so every warehouse's exact unit share has a
        // distinct rounding remainder within its own competition (no
        // ties), so this fixture pins an outcome that does not depend on
        // any particular tie-break policy. Every warehouse has exactly
        // one department, so its entire shipping cost is unambiguous -
        // this fixture isolates the unit-level allocation.
        ClearAllData();
        SeedOrder('UO01', 30);
        SeedWarehouse('UO01', 1, 'Warehouse Alpha', 9, 1.00);
        SeedWarehouse('UO01', 2, 'Warehouse Beta', 3, 2.00);
        SeedWarehouse('UO01', 3, 'Warehouse Gamma', 20, 3.00);
        SeedWarehouse('UO01', 4, 'Warehouse Delta', 24, 4.00);
        SeedDepartment('UO01', 1, 1, 'Dept Alpha', 1);
        SeedDepartment('UO01', 2, 1, 'Dept Beta', 1);
        SeedDepartment('UO01', 3, 1, 'Dept Gamma', 1);
        SeedDepartment('UO01', 4, 1, 'Dept Delta', 1);

        Allocator.AllocateOrder('UO01');

        Assert.AreEqual(5, GetUnitShare('UO01', 1), 'Expected Warehouse Alpha''s unit share to depend only on the order''s weights and total units');
        Assert.AreEqual(1, GetUnitShare('UO01', 2), 'Expected Warehouse Beta''s unit share to depend only on the order''s weights and total units');
        Assert.AreEqual(11, GetUnitShare('UO01', 3), 'Expected Warehouse Gamma''s unit share to depend only on the order''s weights and total units');
        Assert.AreEqual(13, GetUnitShare('UO01', 4), 'Expected Warehouse Delta''s unit share to depend only on the order''s weights and total units');

        Assert.AreEqual(5.00, GetShippingCost('UO01', 1), 'Expected Warehouse Alpha''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(2.00, GetShippingCost('UO01', 2), 'Expected Warehouse Beta''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(33.00, GetShippingCost('UO01', 3), 'Expected Warehouse Gamma''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(52.00, GetShippingCost('UO01', 4), 'Expected Warehouse Delta''s shipping cost to equal its unit share times its unit cost');

        Assert.AreEqual(5.00, GetCostShare('UO01', 1, 1), 'Expected Dept Alpha''s cost share to equal its warehouse''s entire shipping cost');
        Assert.AreEqual(2.00, GetCostShare('UO01', 2, 1), 'Expected Dept Beta''s cost share to equal its warehouse''s entire shipping cost');
        Assert.AreEqual(33.00, GetCostShare('UO01', 3, 1), 'Expected Dept Gamma''s cost share to equal its warehouse''s entire shipping cost');
        Assert.AreEqual(52.00, GetCostShare('UO01', 4, 1), 'Expected Dept Delta''s cost share to equal its warehouse''s entire shipping cost');

        Assert.AreEqual(30, Allocator.GetAllocatedUnitTotal('UO01'), 'Expected every warehouse''s unit share to sum to exactly the order''s total units');
        Assert.AreEqual(92.00, Allocator.GetOrderAllocatedCostTotal('UO01'), 'Expected every department''s cost share to sum to exactly the combined shipping cost of every warehouse');
    end;

    [Test]
    procedure AdversarialDepartmentCostSplitClosesExactlyWhenTheWarehouseUnitShareIsUnambiguous()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        // A single warehouse always receives the order's entire total
        // units, at any granularity, so this fixture's unit-level share
        // is unambiguous - it isolates the cost-level allocation across
        // that warehouse's departments, whose weights are chosen so every
        // department's exact cost share has a distinct rounding
        // remainder (no ties).
        ClearAllData();
        SeedOrder('DL01', 3);
        SeedWarehouse('DL01', 1, 'Warehouse Only', 1, 14.81);
        SeedDepartment('DL01', 1, 1, 'Dept A', 6);
        SeedDepartment('DL01', 1, 2, 'Dept B', 5);
        SeedDepartment('DL01', 1, 3, 'Dept C', 16);
        SeedDepartment('DL01', 1, 4, 'Dept D', 20);

        Allocator.AllocateOrder('DL01');

        Assert.AreEqual(3, GetUnitShare('DL01', 1), 'Expected an order with a single warehouse to allocate its entire total units to that warehouse');
        Assert.AreEqual(44.43, GetShippingCost('DL01', 1), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');

        Assert.AreEqual(5.67, GetCostShare('DL01', 1, 1), 'Expected Dept A''s cost share to depend only on its warehouse''s shipping cost and weights');
        Assert.AreEqual(4.73, GetCostShare('DL01', 1, 2), 'Expected Dept B''s cost share to depend only on its warehouse''s shipping cost and weights');
        Assert.AreEqual(15.12, GetCostShare('DL01', 1, 3), 'Expected Dept C''s cost share to depend only on its warehouse''s shipping cost and weights');
        Assert.AreEqual(18.91, GetCostShare('DL01', 1, 4), 'Expected Dept D''s cost share to depend only on its warehouse''s shipping cost and weights');

        Assert.AreEqual(44.43, Allocator.GetWarehouseAllocatedCostTotal('DL01', 1), 'Expected the departments under the warehouse to sum to exactly that warehouse''s own recorded shipping cost');
    end;

    [Test]
    procedure ZeroWeightWarehouseAndZeroWeightDepartmentAlwaysReceiveExactlyZero()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('ZW01', 45);
        SeedWarehouse('ZW01', 1, 'Warehouse Live', 5, 2.00);
        SeedWarehouse('ZW01', 2, 'Warehouse Sample', 0, 9.99);
        SeedDepartment('ZW01', 1, 1, 'Dept Regular', 3);
        SeedDepartment('ZW01', 1, 2, 'Dept Comp', 0);
        SeedDepartment('ZW01', 2, 1, 'Dept No Order', 7);

        Allocator.AllocateOrder('ZW01');

        Assert.AreEqual(45, GetUnitShare('ZW01', 1), 'Expected a warehouse with weight to receive its full proportional share when the only other warehouse has none');
        Assert.AreEqual(0, GetUnitShare('ZW01', 2), 'Expected a warehouse with no weight to receive exactly zero, even though another warehouse on the same order carries a nonzero total');
        Assert.AreEqual(90.00, GetShippingCost('ZW01', 1), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(0.00, GetShippingCost('ZW01', 2), 'Expected a warehouse with zero unit share to record a shipping cost of exactly zero regardless of its unit cost');
        Assert.AreEqual(90.00, GetCostShare('ZW01', 1, 1), 'Expected a department with weight to receive its full proportional share when the only other department on its warehouse has none');
        Assert.AreEqual(0.00, GetCostShare('ZW01', 1, 2), 'Expected a department with no weight to receive exactly zero, even though another department on the same warehouse carries a nonzero cost share');
        Assert.AreEqual(0.00, GetCostShare('ZW01', 2, 1), 'Expected a department under a warehouse that itself received zero to receive exactly zero, regardless of the department''s own weight');
    end;

    [Test]
    procedure WarehouseWithNoDepartmentWeightLeavesItsDepartmentsUntouched()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('NT01', 80);
        SeedWarehouse('NT01', 1, 'Warehouse Funded', 1, 1.00);
        SeedWarehouse('NT01', 2, 'Warehouse Empty', 1, 1.00);
        SeedDepartment('NT01', 1, 1, 'Dept Live', 1);
        SeedDepartmentWithSentinel('NT01', 2, 1, 'Dept Idle 1', 0, 77.77);
        SeedDepartmentWithSentinel('NT01', 2, 2, 'Dept Idle 2', 0, 88.88);

        Allocator.AllocateOrder('NT01');

        Assert.AreEqual(40, GetUnitShare('NT01', 1), 'Expected a funded warehouse to receive its proportional share of the total units');
        Assert.AreEqual(40, GetUnitShare('NT01', 2), 'Expected a warehouse with weight to receive its proportional share of the total units even when its own departments have none');
        Assert.AreEqual(40.00, GetShippingCost('NT01', 1), 'Expected a warehouse''s shipping cost to equal its unit share times its unit cost');
        Assert.AreEqual(40.00, GetShippingCost('NT01', 2), 'Expected a warehouse''s shipping cost to still be computed even when its own departments have no weight to allocate among');
        Assert.AreEqual(40.00, GetCostShare('NT01', 1, 1), 'Expected the only department on a funded warehouse to receive that warehouse''s entire shipping cost');

        Assert.AreEqual(
          77.77, GetCostShare('NT01', 2, 1),
          'Expected a department''s existing cost share to be left untouched when its warehouse has nothing to allocate among its departments, even though the warehouse itself received a nonzero shipping cost');
        Assert.AreEqual(
          88.88, GetCostShare('NT01', 2, 2),
          'Expected a department''s existing cost share to be left untouched when its warehouse has nothing to allocate among its departments, even though the warehouse itself received a nonzero shipping cost');
    end;

    [Test]
    procedure WholeOrderWithNoWeightAnywhereIsLeftUnallocated()
    var
        ProductionOrder: Record "CG X172 Production Order";
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('NW01', 60);
        SeedWarehouseWithSentinel('NW01', 1, 'Warehouse Idle A', 0, 5.00, 11, 111.11);
        SeedDepartmentWithSentinel('NW01', 1, 1, 'Dept Idle A1', 0, 33.33);
        SeedWarehouseWithSentinel('NW01', 2, 'Warehouse Idle B', 0, 6.00, 22, 222.22);
        SeedDepartmentWithSentinel('NW01', 2, 1, 'Dept Idle B1', 0, 44.44);

        Allocator.AllocateOrder('NW01');

        ProductionOrder.Get('NW01');
        Assert.IsFalse(ProductionOrder.Allocated, 'Expected an order with no weight on any warehouse to be left unallocated');
        Assert.AreEqual(11, GetUnitShare('NW01', 1), 'Expected a warehouse''s existing unit share to be left untouched when the order has no weight to allocate');
        Assert.AreEqual(111.11, GetShippingCost('NW01', 1), 'Expected a warehouse''s existing shipping cost to be left untouched when the order has no weight to allocate');
        Assert.AreEqual(22, GetUnitShare('NW01', 2), 'Expected a warehouse''s existing unit share to be left untouched when the order has no weight to allocate');
        Assert.AreEqual(222.22, GetShippingCost('NW01', 2), 'Expected a warehouse''s existing shipping cost to be left untouched when the order has no weight to allocate');
        Assert.AreEqual(33.33, GetCostShare('NW01', 1, 1), 'Expected a department''s existing cost share to be left untouched when the order has no weight to allocate');
        Assert.AreEqual(44.44, GetCostShare('NW01', 2, 1), 'Expected a department''s existing cost share to be left untouched when the order has no weight to allocate');
    end;

    [Test]
    procedure ReorderingWarehousesNeverChangesTheirUnitShare()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        // Same four warehouse weights as the adversarial fixture above,
        // entered in the opposite order on a second order.
        ClearAllData();

        SeedOrder('PM01', 30);
        SeedWarehouse('PM01', 1, 'Warehouse Alpha', 9, 1.00);
        SeedWarehouse('PM01', 2, 'Warehouse Beta', 3, 1.00);
        SeedWarehouse('PM01', 3, 'Warehouse Gamma', 20, 1.00);
        SeedWarehouse('PM01', 4, 'Warehouse Delta', 24, 1.00);

        SeedOrder('PM02', 30);
        SeedWarehouse('PM02', 1, 'Warehouse Delta', 24, 1.00);
        SeedWarehouse('PM02', 2, 'Warehouse Gamma', 20, 1.00);
        SeedWarehouse('PM02', 3, 'Warehouse Beta', 3, 1.00);
        SeedWarehouse('PM02', 4, 'Warehouse Alpha', 9, 1.00);

        Allocator.AllocateOrder('PM01');
        Allocator.AllocateOrder('PM02');

        Assert.AreEqual(5, GetUnitShare('PM01', 1), 'Expected Warehouse Alpha''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(5, GetUnitShare('PM02', 4), 'Expected Warehouse Alpha''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(1, GetUnitShare('PM01', 2), 'Expected Warehouse Beta''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(1, GetUnitShare('PM02', 3), 'Expected Warehouse Beta''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(11, GetUnitShare('PM01', 3), 'Expected Warehouse Gamma''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(11, GetUnitShare('PM02', 2), 'Expected Warehouse Gamma''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(13, GetUnitShare('PM01', 4), 'Expected Warehouse Delta''s unit share to depend only on the order''s weights and total, never on entry order');
        Assert.AreEqual(13, GetUnitShare('PM02', 1), 'Expected Warehouse Delta''s unit share to depend only on the order''s weights and total, never on entry order');
    end;

    [Test]
    procedure SuccessfulAllocationMarksTheOrderAllocated()
    var
        ProductionOrder: Record "CG X172 Production Order";
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('MK01', 10);
        SeedWarehouse('MK01', 1, 'Warehouse Only', 1, 1.00);
        SeedDepartment('MK01', 1, 1, 'Dept Only', 1);

        Allocator.AllocateOrder('MK01');

        ProductionOrder.Get('MK01');
        Assert.IsTrue(ProductionOrder.Allocated, 'Expected an order with at least one weighted warehouse to be marked allocated');
    end;

    [Test]
    procedure ReallocatingAnOrderReplacesThePreviousSharesRatherThanAccumulating()
    var
        Allocator: Codeunit "CG X172 Shipping Allocator";
    begin
        ClearAllData();
        SeedOrder('RA01', 9);
        SeedWarehouse('RA01', 1, 'Warehouse Only', 4, 5.00);
        SeedDepartment('RA01', 1, 1, 'Dept A', 1);
        SeedDepartment('RA01', 1, 2, 'Dept B', 1);

        Allocator.AllocateOrder('RA01');
        Allocator.AllocateOrder('RA01');

        Assert.AreEqual(9, GetUnitShare('RA01', 1), 'Expected reallocating an unchanged order to leave the unit share exactly as a single allocation would, not accumulated');
        Assert.AreEqual(45.00, GetShippingCost('RA01', 1), 'Expected reallocating an unchanged order to leave the shipping cost exactly as a single allocation would, not accumulated');
        Assert.AreEqual(22.50, GetCostShare('RA01', 1, 1), 'Expected reallocating an unchanged order to leave each department''s cost share exactly as a single allocation would, not accumulated');
        Assert.AreEqual(22.50, GetCostShare('RA01', 1, 2), 'Expected reallocating an unchanged order to leave each department''s cost share exactly as a single allocation would, not accumulated');
    end;

    [Test]
    procedure DeterministicSweepMatchesTheTwoLevelReferenceAcrossManyPartitions()
    var
        Warehouse: Record "CG X172 Warehouse";
        Department: Record "CG X172 Department";
        Allocator: Codeunit "CG X172 Shipping Allocator";
        Any: Codeunit Any;
        WarehouseWeight: array[10] of Decimal;
        ExpectedUnitShare: array[10] of Integer;
        UnitCost: array[10] of Decimal;
        DepartmentWeightRow: array[10] of Decimal;
        DepartmentShareRow: array[10] of Decimal;
        ExpectedCostShare: array[10, 10] of Decimal;
        DepartmentCount: array[10] of Integer;
        OrderNo: Code[20];
        TotalUnits: Integer;
        ExpectedShippingCost: Decimal;
        WarehouseDeptSum: Decimal;
        GrandUnitSum: Integer;
        GrandCostSum: Decimal;
        WarehouseCount: Integer;
        Partition: Integer;
        i: Integer;
        j: Integer;
    begin
        Any.SetSeed(172);

        for Partition := 1 to 6 do begin
            ClearAllData();
            OrderNo := 'SW' + Format(Partition);
            WarehouseCount := Any.IntegerInRange(3, 6);
            TotalUnits := Any.IntegerInRange(20, 500);
            SeedOrder(OrderNo, TotalUnits);

            for i := 1 to WarehouseCount do begin
                // Roughly every fourth warehouse on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    WarehouseWeight[i] := 0
                else
                    WarehouseWeight[i] := Any.DecimalInRange(1, 400, 3);
                UnitCost[i] := Any.IntegerInRange(50, 5000) / 100;
                SeedWarehouse(OrderNo, i, StrSubstNo('Sweep warehouse %1', i), WarehouseWeight[i], UnitCost[i]);
            end;

            ComputeIntegerLevelShares(WarehouseWeight, WarehouseCount, TotalUnits, ExpectedUnitShare);

            for i := 1 to WarehouseCount do begin
                DepartmentCount[i] := Any.IntegerInRange(2, 5);
                for j := 1 to DepartmentCount[i] do begin
                    if j mod 3 = 0 then
                        DepartmentWeightRow[j] := 0
                    else
                        DepartmentWeightRow[j] := Any.DecimalInRange(1, 300, 3);
                    SeedDepartment(OrderNo, i, j, StrSubstNo('Sweep warehouse %1 dept %2', i, j), DepartmentWeightRow[j]);
                end;
                ExpectedShippingCost := ExpectedUnitShare[i] * UnitCost[i];
                ComputeCentLevelShares(DepartmentWeightRow, DepartmentCount[i], ExpectedShippingCost, DepartmentShareRow);
                for j := 1 to DepartmentCount[i] do
                    ExpectedCostShare[i, j] := DepartmentShareRow[j];
            end;

            Allocator.AllocateOrder(OrderNo);

            GrandUnitSum := 0;
            GrandCostSum := 0;
            for i := 1 to WarehouseCount do begin
                Warehouse.Get(OrderNo, i);
                Assert.AreEqual(
                  ExpectedUnitShare[i], Warehouse."Unit Share",
                  StrSubstNo('Expected warehouse %1 of sweep partition %2 to depend only on that order''s own weights and total units', i, Partition));
                Assert.AreEqual(
                  ExpectedUnitShare[i] * UnitCost[i], Warehouse."Shipping Cost",
                  StrSubstNo('Expected warehouse %1''s shipping cost on sweep partition %2 to equal its own unit share times its own unit cost', i, Partition));

                WarehouseDeptSum := 0;
                for j := 1 to DepartmentCount[i] do begin
                    Department.Get(OrderNo, i, j);
                    Assert.AreEqual(
                      ExpectedCostShare[i, j], Department."Cost Share",
                      StrSubstNo('Expected department %1 of warehouse %2 of sweep partition %3 to depend only on its warehouse''s shipping cost and weights', j, i, Partition));
                    WarehouseDeptSum += Department."Cost Share";
                end;
                Assert.AreEqual(
                  Warehouse."Shipping Cost", WarehouseDeptSum,
                  StrSubstNo('Expected the departments under warehouse %1 of sweep partition %2 to sum to exactly that warehouse''s own recorded shipping cost', i, Partition));

                GrandUnitSum += Warehouse."Unit Share";
                GrandCostSum += Warehouse."Shipping Cost";
            end;
            Assert.AreEqual(
              TotalUnits, GrandUnitSum,
              StrSubstNo('Expected every warehouse''s unit share on sweep partition %1 to sum to exactly the order''s total units', Partition));
            Assert.AreEqual(
              GrandCostSum, Allocator.GetOrderAllocatedCostTotal(OrderNo),
              StrSubstNo('Expected the order-level cost reconciliation on sweep partition %1 to equal the sum of every warehouse''s own shipping cost', Partition));
        end;
    end;
}
