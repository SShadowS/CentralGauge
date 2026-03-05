codeunit 80125 "CG-AL-H025 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        TransferEngine: Codeunit "CG Data Transfer Engine";

    local procedure SetupSourceData()
    var
        Source: Record "CG Transfer Source";
    begin
        Source.DeleteAll();

        Source.Code := 'SRC001';
        Source.Description := 'Source Item 1';
        Source.Amount := 100.00;
        Source.Category := 'CAT-A';
        Source.Insert();

        Source.Code := 'SRC002';
        Source.Description := 'Source Item 2';
        Source.Amount := 200.00;
        Source.Category := 'CAT-A';
        Source.Insert();

        Source.Code := 'SRC003';
        Source.Description := 'Source Item 3';
        Source.Amount := 300.00;
        Source.Category := 'CAT-B';
        Source.Insert();
    end;

    local procedure CleanupAll()
    var
        Source: Record "CG Transfer Source";
        Dest: Record "CG Transfer Dest";
    begin
        Source.DeleteAll();
        Dest.DeleteAll();
    end;

    [Test]
    procedure TestTransferAllData_CopiesAllRecords()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferAllData copies all source records to destination
        // [GIVEN] Source data exists
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring all data
        TransferEngine.TransferAllData();

        // [THEN] All records are in destination
        Assert.AreEqual(3, Dest.Count, 'Should have 3 records in destination');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferAllData_FieldsMapped()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferAllData maps fields correctly
        // [GIVEN] Source data
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring all data
        TransferEngine.TransferAllData();

        // [THEN] Fields are correctly mapped
        Dest.Get('SRC001');
        Assert.AreEqual('Source Item 1', Dest.Description, 'Description should match');
        Assert.AreEqual(100.00, Dest.Amount, 'Amount should match');
        Assert.AreEqual('CAT-A', Dest.Category, 'Category should match');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferWithSourceFilter_FiltersCorrectly()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferWithSourceFilter only copies matching records
        // [GIVEN] Source data with mixed categories
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring with CAT-A filter
        TransferEngine.TransferWithSourceFilter('CAT-A');

        // [THEN] Only CAT-A records transferred
        Assert.AreEqual(2, Dest.Count, 'Should have 2 CAT-A records');
        Assert.IsTrue(Dest.Get('SRC001'), 'SRC001 should exist');
        Assert.IsTrue(Dest.Get('SRC002'), 'SRC002 should exist');
        Assert.IsFalse(Dest.Get('SRC003'), 'SRC003 should not exist');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferWithSourceFilter_NoMatch()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferWithSourceFilter with no matches transfers nothing
        // [GIVEN] Source data
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring with non-existent category
        TransferEngine.TransferWithSourceFilter('CAT-Z');

        // [THEN] No records transferred
        Assert.AreEqual(0, Dest.Count, 'Should have 0 records for non-matching filter');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferWithDestinationFilter_UpdatesFiltered()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferWithDestinationFilter updates only matching dest records
        // [GIVEN] Source and destination data
        CleanupAll();
        SetupSourceData();
        TransferEngine.TransferAllData();

        // [WHEN] Updating CAT-A records with new description
        TransferEngine.TransferWithDestinationFilter('CAT-A', 'Updated Description');

        // [THEN] CAT-A records are updated
        Dest.Get('SRC001');
        Assert.AreEqual('Updated Description', Dest.Description, 'CAT-A record should be updated');

        // CAT-B record should be unchanged
        Dest.Get('SRC003');
        Assert.AreEqual('Source Item 3', Dest.Description, 'CAT-B record should not be updated');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferWithConstantValue_OverridesAmount()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferWithConstantValue overrides amount with constant
        // [GIVEN] Source data
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring with constant amount 999.99
        TransferEngine.TransferWithConstantValue(999.99);

        // [THEN] All records have the constant amount
        Dest.Get('SRC001');
        Assert.AreEqual(999.99, Dest.Amount, 'Amount should be constant value');
        Assert.AreEqual('Source Item 1', Dest.Description, 'Description should still be from source');

        Dest.Get('SRC003');
        Assert.AreEqual(999.99, Dest.Amount, 'All records should have constant amount');

        // Cleanup
        CleanupAll();
    end;

    [Test]
    procedure TestTransferWithConstantValue_PreservesOtherFields()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] TransferWithConstantValue preserves non-overridden fields
        // [GIVEN] Source data
        CleanupAll();
        SetupSourceData();

        // [WHEN] Transferring with constant amount
        TransferEngine.TransferWithConstantValue(50.00);

        // [THEN] Other fields are preserved from source
        Dest.Get('SRC002');
        Assert.AreEqual('Source Item 2', Dest.Description, 'Description should be preserved');
        Assert.AreEqual('CAT-A', Dest.Category, 'Category should be preserved');
        Assert.AreEqual(50.00, Dest.Amount, 'Amount should be overridden');

        // Cleanup
        CleanupAll();
    end;
}
