codeunit 80261 "CG-AL-H046 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestAllSeededItemsAppearAsLines()
    var
        Item: Record "CG H046 Sample Item";
        ItemList: Codeunit "CG H046 Item List";
        Output: Text;
    begin
        Output := ItemList.BuildItemList(Item);

        Assert.IsTrue(StrPos(Output, 'I1,Alpha') > 0, 'Output must contain ''I1,Alpha''.');
        Assert.IsTrue(StrPos(Output, 'I2,Beta') > 0, 'Output must contain ''I2,Beta''.');
        Assert.IsTrue(StrPos(Output, 'I3,Gamma') > 0, 'Output must contain ''I3,Gamma''.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestEmptyFilterReturnsEmpty()
    var
        Item: Record "CG H046 Sample Item";
        ItemList: Codeunit "CG H046 Item List";
        Output: Text;
    begin
        Item.SetRange("No.", 'NOTHING-MATCHES-THIS');
        Output := ItemList.BuildItemList(Item);

        Assert.AreEqual('', Output, 'Empty filter set must produce empty output.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestFilteredSubsetOnlyContainsMatched()
    var
        Item: Record "CG H046 Sample Item";
        ItemList: Codeunit "CG H046 Item List";
        Output: Text;
    begin
        Item.SetRange("No.", 'I2');
        Output := ItemList.BuildItemList(Item);

        Assert.IsTrue(StrPos(Output, 'I2,Beta') > 0, 'Filtered output must contain I2.');
        Assert.IsTrue(StrPos(Output, 'I1,Alpha') = 0, 'Filtered output must NOT contain I1.');
        Assert.IsTrue(StrPos(Output, 'I3,Gamma') = 0, 'Filtered output must NOT contain I3.');
    end;
}
