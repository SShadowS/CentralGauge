codeunit 80320 "CG-AL-X031 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Item: Record "CG X031 Item";
    begin
        Item.DeleteAll();
    end;

    local procedure SeedItems()
    var
        Item: Record "CG X031 Item";
    begin
        // [GIVEN] opaque, distinct, non-round prices so a sum can't be
        // guessed or hardcoded
        Item.Init();
        Item."No." := 'A';
        Item.Price := 10;
        Item.Insert();

        Item.Init();
        Item."No." := 'B';
        Item.Price := 20;
        Item.Insert();

        Item.Init();
        Item."No." := 'C';
        Item.Price := 45;
        Item.Insert();
    end;

    [Test]
    procedure TotalPriceSumsAllExistingItems()
    var
        Pricer: Codeunit "CG X031 Pricer";
        ItemNos: List of [Code[20]];
        Result: Integer;
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // "CG X031 Item" rows behind on the shared container.
        ClearState();
        Commit();
        SeedItems();

        // [GIVEN] a list with no missing item numbers at all
        ItemNos.Add('A');
        ItemNos.Add('B');
        ItemNos.Add('C');

        // [WHEN]
        Result := Pricer.TotalPrice(ItemNos);

        // [THEN] sanity case: passes regardless of whether the missing-key
        // return value is checked, since nothing is missing
        Assert.AreEqual(75, Result, 'TotalPrice must sum the Price of every listed item');

        ClearState();
    end;

    [Test]
    procedure TotalPriceSkipsOneMissingItemAfterAHit()
    var
        Pricer: Codeunit "CG X031 Pricer";
        ItemNos: List of [Code[20]];
        Result: Integer;
    begin
        // [GIVEN] self-heal
        ClearState();
        Commit();
        SeedItems();

        // [GIVEN] a missing item number placed right after a found one
        ItemNos.Add('A');
        ItemNos.Add('MISSING');
        ItemNos.Add('B');

        // [WHEN]
        Result := Pricer.TotalPrice(ItemNos);

        // [THEN] the discriminator: an implementation that does not check
        // whether the lookup for 'MISSING' actually found a row contributes
        // the previous item's price a second time instead of 0
        Assert.AreEqual(30, Result, 'TotalPrice must contribute 0 for an item number with no matching item');

        ClearState();
    end;

    [Test]
    procedure TotalPriceSkipsTwoConsecutiveMissingItemsAfterAHit()
    var
        Pricer: Codeunit "CG X031 Pricer";
        ItemNos: List of [Code[20]];
        Result: Integer;
    begin
        // [GIVEN] self-heal
        ClearState();
        Commit();
        SeedItems();

        // [GIVEN] two consecutive missing item numbers after a found one, to
        // prove the repeated-price bug isn't a one-off
        ItemNos.Add('C');
        ItemNos.Add('MISS1');
        ItemNos.Add('MISS2');

        // [WHEN]
        Result := Pricer.TotalPrice(ItemNos);

        // [THEN]
        Assert.AreEqual(45, Result, 'TotalPrice must contribute 0 for every item number with no matching item');

        ClearState();
    end;
}
