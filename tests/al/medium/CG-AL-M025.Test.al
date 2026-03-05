codeunit 80025 "CG-AL-M025 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        BulkManager: Codeunit "CG Bulk Data Manager";

    [Test]
    procedure TestInsertRecords_InsertsCorrectCount()
    var
        CountBefore: Integer;
    begin
        // [SCENARIO] InsertRecords adds the specified number of records
        // [GIVEN] Empty table
        BulkManager.TruncateAll();
        CountBefore := BulkManager.GetRecordCount();
        Assert.AreEqual(0, CountBefore, 'Table should be empty after truncate');

        // [WHEN] Inserting 5 records
        BulkManager.InsertRecords(5);

        // [THEN] Count is 5
        Assert.AreEqual(5, BulkManager.GetRecordCount(), 'Should have 5 records after insert');

        // Cleanup
        BulkManager.TruncateAll();
    end;

    [Test]
    procedure TestTruncateAll_RemovesAllRecords()
    begin
        // [SCENARIO] TruncateAll removes all records
        // [GIVEN] Records exist
        BulkManager.InsertRecords(10);
        Assert.IsTrue(BulkManager.GetRecordCount() > 0, 'Should have records before truncate');

        // [WHEN] Truncating
        BulkManager.TruncateAll();

        // [THEN] No records remain
        Assert.AreEqual(0, BulkManager.GetRecordCount(), 'Should have 0 records after truncate');
    end;

    [Test]
    procedure TestTruncateAll_EmptyTable()
    begin
        // [SCENARIO] TruncateAll on empty table does not error
        // [GIVEN] Empty table
        BulkManager.TruncateAll();

        // [WHEN] Truncating again
        BulkManager.TruncateAll();

        // [THEN] Still 0 records (no error)
        Assert.AreEqual(0, BulkManager.GetRecordCount(), 'Should still have 0 records');
    end;

    [Test]
    procedure TestGetRecordCount_Zero()
    begin
        // [SCENARIO] GetRecordCount returns 0 for empty table
        // [GIVEN] Empty table
        BulkManager.TruncateAll();

        // [WHEN] Getting count
        // [THEN] Returns 0
        Assert.AreEqual(0, BulkManager.GetRecordCount(), 'Empty table should return 0');
    end;

    [Test]
    procedure TestGetRecordCount_AfterInsert()
    begin
        // [SCENARIO] GetRecordCount returns correct count after inserts
        // [GIVEN] Table with records
        BulkManager.TruncateAll();
        BulkManager.InsertRecords(3);

        // [WHEN] Getting count
        // [THEN] Returns 3
        Assert.AreEqual(3, BulkManager.GetRecordCount(), 'Should return 3 after inserting 3 records');

        // Cleanup
        BulkManager.TruncateAll();
    end;

    [Test]
    procedure TestInsertAndTruncate_ReturnsZero()
    var
        Result: Integer;
    begin
        // [SCENARIO] InsertAndTruncate inserts then truncates and returns 0
        // [WHEN] Inserting and truncating 5 records
        Result := BulkManager.InsertAndTruncate(5);

        // [THEN] Returns 0
        Assert.AreEqual(0, Result, 'Should return 0 after insert and truncate');
    end;

    [Test]
    procedure TestTruncateWithRecordRef_RemovesRecords()
    begin
        // [SCENARIO] TruncateWithRecordRef removes all records via RecordRef
        // [GIVEN] Records exist
        BulkManager.InsertRecords(7);
        Assert.IsTrue(BulkManager.GetRecordCount() > 0, 'Should have records before RecordRef truncate');

        // [WHEN] Truncating via RecordRef
        BulkManager.TruncateWithRecordRef(69030);

        // [THEN] No records remain
        Assert.AreEqual(0, BulkManager.GetRecordCount(), 'Should have 0 records after RecordRef truncate');
    end;
}
