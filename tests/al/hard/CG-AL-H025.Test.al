codeunit 80125 "CG-AL-H025 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestDestinationHasTenRecords()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] DataTransfer copied all 10 source records to destination
        // [THEN] Destination has exactly 10 records
        Assert.AreEqual(10, Dest.Count, 'Destination should have 10 records');
    end;

    [Test]
    procedure TestFirstRecordFields()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] First record fields are correctly mapped
        // [THEN] SRC001 exists with correct data
        Assert.IsTrue(Dest.Get('SRC001'), 'SRC001 should exist in destination');
        Assert.AreEqual('Alpha Product', Dest.Description, 'SRC001 Description should match');
        Assert.AreEqual(100.00, Dest.Amount, 'SRC001 Amount should match');
        Assert.AreEqual('CAT-A', Dest.Category, 'SRC001 Category should match');
        Assert.IsTrue(Dest.Enabled, 'SRC001 Enabled should be true');
    end;

    [Test]
    procedure TestZeroAmountRecord()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] Record with zero amount is correctly transferred
        // [THEN] SRC003 has zero amount and inactive
        Assert.IsTrue(Dest.Get('SRC003'), 'SRC003 should exist in destination');
        Assert.AreEqual('Gamma Product', Dest.Description, 'SRC003 Description should match');
        Assert.AreEqual(0.00, Dest.Amount, 'SRC003 Amount should be zero');
        Assert.AreEqual('CAT-B', Dest.Category, 'SRC003 Category should match');
        Assert.IsFalse(Dest.Enabled, 'SRC003 Enabled should be false');
    end;

    [Test]
    procedure TestLastRecordFields()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] Last record is correctly transferred
        // [THEN] SRC010 exists with correct data
        Assert.IsTrue(Dest.Get('SRC010'), 'SRC010 should exist in destination');
        Assert.AreEqual('Kappa Product', Dest.Description, 'SRC010 Description should match');
        Assert.AreEqual(450.00, Dest.Amount, 'SRC010 Amount should match');
        Assert.AreEqual('CAT-C', Dest.Category, 'SRC010 Category should match');
        Assert.IsFalse(Dest.Enabled, 'SRC010 Enabled should be false');
    end;

    [Test]
    procedure TestSmallDecimalAmount()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] Small decimal amount is preserved in transfer
        // [THEN] SRC009 has 0.01 amount
        Assert.IsTrue(Dest.Get('SRC009'), 'SRC009 should exist in destination');
        Assert.AreEqual(0.01, Dest.Amount, 'SRC009 Amount should be 0.01');
        Assert.IsTrue(Dest.Enabled, 'SRC009 Enabled should be true');
    end;

    [Test]
    procedure TestLargeAmount()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] Large amount is preserved in transfer
        // [THEN] SRC008 has 3200.00 amount
        Assert.IsTrue(Dest.Get('SRC008'), 'SRC008 should exist in destination');
        Assert.AreEqual(3200.00, Dest.Amount, 'SRC008 Amount should be 3200');
        Assert.AreEqual('Theta Product', Dest.Description, 'SRC008 Description should match');
    end;

    [Test]
    procedure TestAllCategoriesTransferred()
    var
        Dest: Record "CG Transfer Dest";
    begin
        // [SCENARIO] Records from all categories are transferred
        // [WHEN] Filtering by CAT-A
        Dest.SetRange(Category, 'CAT-A');
        Assert.AreEqual(4, Dest.Count, 'Should have 4 CAT-A records');

        // [WHEN] Filtering by CAT-B
        Dest.SetRange(Category, 'CAT-B');
        Assert.AreEqual(3, Dest.Count, 'Should have 3 CAT-B records');

        // [WHEN] Filtering by CAT-C
        Dest.SetRange(Category, 'CAT-C');
        Assert.AreEqual(3, Dest.Count, 'Should have 3 CAT-C records');
    end;
}
