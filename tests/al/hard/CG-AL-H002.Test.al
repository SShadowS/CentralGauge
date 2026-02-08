codeunit 80002 "CG-AL-H002 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure CleanupAll()
    var
        Warehouse: Record "CG Warehouse";
        WarehouseEntry: Record "CG Warehouse Entry";
    begin
        WarehouseEntry.DeleteAll(false);
        Warehouse.DeleteAll(false);
    end;

    local procedure GetNextEntryNo(): Integer
    var
        WarehouseEntry: Record "CG Warehouse Entry";
    begin
        if WarehouseEntry.FindLast() then
            exit(WarehouseEntry."Entry No." + 1);
        exit(1);
    end;

    local procedure CreateWarehouseEntry(WhsCode: Code[10]; ItemNo: Code[20]; Qty: Decimal)
    var
        WarehouseEntry: Record "CG Warehouse Entry";
    begin
        WarehouseEntry.Init();
        WarehouseEntry."Entry No." := GetNextEntryNo();
        WarehouseEntry."Warehouse Code" := WhsCode;
        WarehouseEntry."Item No." := ItemNo;
        WarehouseEntry.Quantity := Qty;
        WarehouseEntry."Posting Date" := WorkDate();
        WarehouseEntry.Insert(false);
    end;

    [Test]
    procedure TestFlowFieldSum()
    var
        Warehouse: Record "CG Warehouse";
        WhsCode: Code[10];
    begin
        // [SCENARIO] FlowField sums quantities correctly
        WhsCode := 'WHS001';

        // [GIVEN] Clean state
        CleanupAll();

        Warehouse.Init();
        Warehouse.Code := WhsCode;
        Warehouse.Name := 'Test Warehouse';
        Warehouse.Insert(false);

        // Add entries
        CreateWarehouseEntry(WhsCode, 'ITEM1', 100);
        CreateWarehouseEntry(WhsCode, 'ITEM2', 50.5);

        // Verify FlowField
        Warehouse.Get(WhsCode);
        Warehouse.CalcFields("Total Inventory Qty");
        Assert.AreEqual(150.5, Warehouse."Total Inventory Qty", 'FlowField sum incorrect');
    end;

    [Test]
    procedure TestFlowFieldCount()
    var
        Warehouse: Record "CG Warehouse";
        WhsCode: Code[10];
    begin
        // [SCENARIO] FlowField counts entries correctly
        WhsCode := 'WHS002';

        // [GIVEN] Clean state
        CleanupAll();

        Warehouse.Init();
        Warehouse.Code := WhsCode;
        Warehouse.Name := 'Test Warehouse 2';
        Warehouse.Insert(false);

        // Add 3 entries
        CreateWarehouseEntry(WhsCode, 'ITEM1', 10);
        CreateWarehouseEntry(WhsCode, 'ITEM2', 20);
        CreateWarehouseEntry(WhsCode, 'ITEM3', 30);

        // Verify FlowField
        Warehouse.Get(WhsCode);
        Warehouse.CalcFields("Entry Count");
        Assert.AreEqual(3, Warehouse."Entry Count", 'FlowField count incorrect');
    end;

    [Test]
    procedure TestFlowFieldWithNegativeQuantity()
    var
        Warehouse: Record "CG Warehouse";
        WhsCode: Code[10];
    begin
        // [SCENARIO] FlowField handles negative quantities
        WhsCode := 'WHS003';

        // [GIVEN] Clean state
        CleanupAll();

        Warehouse.Init();
        Warehouse.Code := WhsCode;
        Warehouse.Name := 'Test Warehouse 3';
        Warehouse.Insert(false);

        CreateWarehouseEntry(WhsCode, 'ITEM1', 100);
        CreateWarehouseEntry(WhsCode, 'ITEM1', -30);

        Warehouse.Get(WhsCode);
        Warehouse.CalcFields("Total Inventory Qty");
        Assert.AreEqual(70, Warehouse."Total Inventory Qty", 'FlowField should handle negative quantities');
    end;

    [Test]
    procedure TestFlowFieldZeroWhenNoEntries()
    var
        Warehouse: Record "CG Warehouse";
        WhsCode: Code[10];
    begin
        // [SCENARIO] FlowField is 0 when no entries exist
        WhsCode := 'WHS004';

        // [GIVEN] Clean state
        CleanupAll();

        Warehouse.Init();
        Warehouse.Code := WhsCode;
        Warehouse.Name := 'Empty Warehouse';
        Warehouse.Insert(false);

        Warehouse.Get(WhsCode);
        Warehouse.CalcFields("Total Inventory Qty", "Entry Count");
        Assert.AreEqual(0, Warehouse."Total Inventory Qty", 'FlowField sum should be 0 with no entries');
        Assert.AreEqual(0, Warehouse."Entry Count", 'FlowField count should be 0 with no entries');
    end;
}
