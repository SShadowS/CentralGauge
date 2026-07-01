codeunit 80299 "CG-AL-X010 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Item: Record "CG X010 Item";
    begin
        Item.DeleteAll();
    end;

    [Test]
    procedure SumOrEmptyReturnsSumOfAllRows()
    var
        Item: Record "CG X010 Item";
        Aggregator: Codeunit "CG X010 Aggregator";
        Result: Integer;
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave "CG X010 Item" rows behind on the shared
        // container. Wipe it, committed, before seeding.
        ClearState();
        Commit();

        // [GIVEN] three rows whose values sum to a distinct, easy-to-verify
        // total that is independent of the codeunit under test
        Item.Init();
        Item."Code" := 'CGX010A';
        Item.Value := 10;
        Item.Insert();

        Item.Init();
        Item."Code" := 'CGX010B';
        Item.Value := 25;
        Item.Insert();

        Item.Init();
        Item."Code" := 'CGX010C';
        Item.Value := 7;
        Item.Insert();

        // [WHEN]
        Result := Aggregator.SumOrEmpty();

        // [THEN]
        Assert.AreEqual(42, Result, 'SumOrEmpty must return the sum of Value across all rows');

        ClearState();
    end;

    [Test]
    procedure SumOrEmptyReturnsDifferentSumForDifferentSeed()
    var
        Item: Record "CG X010 Item";
        Aggregator: Codeunit "CG X010 Aggregator";
        Result: Integer;
    begin
        // [GIVEN] self-heal
        ClearState();
        Commit();

        // [GIVEN] a different value distribution, so a solution that
        // hardcodes the first test's total cannot pass by coincidence
        Item.Init();
        Item."Code" := 'CGX010X';
        Item.Value := 100;
        Item.Insert();

        Item.Init();
        Item."Code" := 'CGX010Y';
        Item.Value := 200;
        Item.Insert();

        Item.Init();
        Item."Code" := 'CGX010Z';
        Item.Value := 1;
        Item.Insert();

        // [WHEN]
        Result := Aggregator.SumOrEmpty();

        // [THEN]
        Assert.AreEqual(301, Result, 'SumOrEmpty must return the sum of Value across all rows');

        ClearState();
    end;

    [Test]
    procedure SumOrEmptyReturnsMinusOneWhenTableEmpty()
    var
        Aggregator: Codeunit "CG X010 Aggregator";
        Result: Integer;
    begin
        // [GIVEN] self-heal: no rows at all in "CG X010 Item"
        ClearState();
        Commit();

        // [WHEN]
        Result := Aggregator.SumOrEmpty();

        // [THEN] the discriminator: an implementation that iterates the
        // table without first confirming there is anything to iterate
        // produces a stale/blank total here instead of the required
        // empty-table sentinel
        Assert.AreEqual(-1, Result, 'SumOrEmpty must return -1 when the table has no rows');
    end;
}
