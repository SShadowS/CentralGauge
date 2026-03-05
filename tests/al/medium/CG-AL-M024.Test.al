codeunit 80024 "CG-AL-M024 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        JsonSelector: Codeunit "CG JSON Path Selector";

    [Test]
    procedure TestSelectAllNames_ReturnsThreeNames()
    var
        Names: List of [Text];
    begin
        // [SCENARIO] SelectAllNames returns all employee names
        // [WHEN] Selecting all names
        Names := JsonSelector.SelectAllNames();

        // [THEN] Returns 3 names
        Assert.AreEqual(3, Names.Count, 'Should return 3 employee names');
    end;

    [Test]
    procedure TestSelectAllNames_ContainsExpectedNames()
    var
        Names: List of [Text];
    begin
        // [SCENARIO] SelectAllNames contains specific names
        // [WHEN] Selecting all names
        Names := JsonSelector.SelectAllNames();

        // [THEN] Contains expected names
        Assert.IsTrue(Names.Contains('Alice'), 'Should contain Alice');
        Assert.IsTrue(Names.Contains('Bob'), 'Should contain Bob');
        Assert.IsTrue(Names.Contains('Charlie'), 'Should contain Charlie');
    end;

    [Test]
    procedure TestSelectByIndex_FirstElement()
    var
        Result: Text;
    begin
        // [SCENARIO] SelectByIndex returns the correct employee name
        // [WHEN] Selecting index 0
        Result := JsonSelector.SelectByIndex(0);

        // [THEN] Returns first employee name
        Assert.AreEqual('Alice', Result, 'Index 0 should return Alice');
    end;

    [Test]
    procedure TestSelectByIndex_LastElement()
    var
        Result: Text;
    begin
        // [SCENARIO] SelectByIndex returns last element correctly
        // [WHEN] Selecting index 2
        Result := JsonSelector.SelectByIndex(2);

        // [THEN] Returns last employee name
        Assert.AreEqual('Charlie', Result, 'Index 2 should return Charlie');
    end;

    [Test]
    procedure TestSelectByIndex_OutOfRange()
    var
        Result: Text;
    begin
        // [SCENARIO] SelectByIndex returns empty for out-of-range index
        // [WHEN] Selecting invalid index
        Result := JsonSelector.SelectByIndex(10);

        // [THEN] Returns empty text
        Assert.AreEqual('', Result, 'Out of range index should return empty text');
    end;

    [Test]
    procedure TestCountMatchingTokens_Engineering()
    var
        Count: Integer;
    begin
        // [SCENARIO] CountMatchingTokens counts employees in Engineering
        // [WHEN] Counting Engineering department
        Count := JsonSelector.CountMatchingTokens('Engineering');

        // [THEN] Returns 2
        Assert.AreEqual(2, Count, 'Engineering should have 2 employees');
    end;

    [Test]
    procedure TestCountMatchingTokens_Marketing()
    var
        Count: Integer;
    begin
        // [SCENARIO] CountMatchingTokens counts employees in Marketing
        // [WHEN] Counting Marketing department
        Count := JsonSelector.CountMatchingTokens('Marketing');

        // [THEN] Returns 1
        Assert.AreEqual(1, Count, 'Marketing should have 1 employee');
    end;

    [Test]
    procedure TestCountMatchingTokens_NonExistent()
    var
        Count: Integer;
    begin
        // [SCENARIO] CountMatchingTokens returns 0 for non-existent department
        // [WHEN] Counting HR department
        Count := JsonSelector.CountMatchingTokens('HR');

        // [THEN] Returns 0
        Assert.AreEqual(0, Count, 'Non-existent department should return 0');
    end;

    [Test]
    procedure TestSelectNestedValues_CorrectSum()
    var
        Total: Decimal;
    begin
        // [SCENARIO] SelectNestedValues sums all order amounts
        // [WHEN] Selecting nested values
        Total := JsonSelector.SelectNestedValues();

        // [THEN] Sum is correct (150.50 + 299.99 + 75.00 = 525.49)
        Assert.AreEqual(525.49, Total, 'Sum of amounts should be 525.49');
    end;

    [Test]
    procedure TestSelectNestedValues_PositiveSum()
    var
        Total: Decimal;
    begin
        // [SCENARIO] SelectNestedValues returns a positive value
        // [WHEN] Selecting nested values
        Total := JsonSelector.SelectNestedValues();

        // [THEN] Sum is positive
        Assert.IsTrue(Total > 0, 'Sum should be greater than zero');
    end;
}
