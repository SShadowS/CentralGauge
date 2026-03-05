codeunit 80055 "CG-AL-E055 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        FQNHelper: Codeunit "CG Record FQN Helper";

    [Test]
    procedure TestGetCustomerFQN_ContainsTableName()
    var
        Result: Text;
    begin
        // [SCENARIO] GetCustomerFQN returns FQN containing Customer table name
        // [WHEN] Getting Customer FQN
        Result := FQNHelper.GetCustomerFQN();

        // [THEN] Contains "Customer"
        Assert.IsTrue(Result.Contains('Customer'), 'FQN should contain Customer');
    end;

    [Test]
    procedure TestGetCustomerFQN_NotEmpty()
    var
        Result: Text;
    begin
        // [SCENARIO] GetCustomerFQN returns non-empty text
        // [WHEN] Getting Customer FQN
        Result := FQNHelper.GetCustomerFQN();

        // [THEN] Not empty
        Assert.AreNotEqual('', Result, 'FQN should not be empty');
    end;

    [Test]
    procedure TestGetItemFQN_ContainsTableName()
    var
        Result: Text;
    begin
        // [SCENARIO] GetItemFQN returns FQN containing Item table name
        // [WHEN] Getting Item FQN
        Result := FQNHelper.GetItemFQN();

        // [THEN] Contains "Item"
        Assert.IsTrue(Result.Contains('Item'), 'FQN should contain Item');
    end;

    [Test]
    procedure TestGetTableFQN_CustomerTable()
    var
        Result: Text;
    begin
        // [SCENARIO] GetTableFQN returns FQN for a given table ID
        // [WHEN] Getting FQN for Customer table (18)
        Result := FQNHelper.GetTableFQN(Database::Customer);

        // [THEN] Contains Customer
        Assert.IsTrue(Result.Contains('Customer'), 'FQN should contain Customer for table 18');
    end;

    [Test]
    procedure TestGetTableFQN_ItemTable()
    var
        Result: Text;
    begin
        // [SCENARIO] GetTableFQN works with different table IDs
        // [WHEN] Getting FQN for Item table (27)
        Result := FQNHelper.GetTableFQN(Database::Item);

        // [THEN] Contains Item
        Assert.IsTrue(Result.Contains('Item'), 'FQN should contain Item for table 27');
    end;

    [Test]
    procedure TestGetCustomerFQN_HasNamespacePrefix()
    var
        Result: Text;
    begin
        // [SCENARIO] FQN includes namespace prefix with dot
        // [WHEN] Getting Customer FQN
        Result := FQNHelper.GetCustomerFQN();

        // [THEN] Contains dot separator indicating namespace
        Assert.IsTrue(Result.Contains('.'), 'FQN should contain namespace dot separator');
    end;

    [Test]
    procedure TestContainsNamespace_WithNamespace()
    var
        Result: Boolean;
        FQN: Text;
    begin
        // [SCENARIO] ContainsNamespace returns true for FQN with namespace
        // [GIVEN] A FQN from a standard table
        FQN := FQNHelper.GetCustomerFQN();

        // [WHEN] Checking for namespace
        Result := FQNHelper.ContainsNamespace(FQN);

        // [THEN] Returns true
        Assert.IsTrue(Result, 'Standard table FQN should have namespace');
    end;

    [Test]
    procedure TestContainsNamespace_WithoutNamespace()
    var
        Result: Boolean;
    begin
        // [SCENARIO] ContainsNamespace returns false for plain text without dot
        // [WHEN] Checking plain text
        Result := FQNHelper.ContainsNamespace('SimpleTableName');

        // [THEN] Returns false
        Assert.IsFalse(Result, 'Plain text without dot should return false');
    end;

    [Test]
    procedure TestGetCustomerFQN_MatchesRecordRef()
    var
        DirectFQN: Text;
        RecRefFQN: Text;
    begin
        // [SCENARIO] Direct record FQN matches RecordRef FQN for same table
        // [WHEN] Getting FQN both ways
        DirectFQN := FQNHelper.GetCustomerFQN();
        RecRefFQN := FQNHelper.GetTableFQN(Database::Customer);

        // [THEN] They match
        Assert.AreEqual(DirectFQN, RecRefFQN, 'Direct and RecordRef FQN should match for same table');
    end;
}
