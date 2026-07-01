codeunit 80294 "CG-AL-X005 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearItems()
    var
        Item: Record "CG X005 Item";
    begin
        Item.DeleteAll();
    end;

    local procedure SeedItem(ItemCode: Code[10]; ItemValue: Integer)
    var
        Item: Record "CG X005 Item";
    begin
        Item.Init();
        Item."Code" := ItemCode;
        Item."Value" := ItemValue;
        Item."Flag" := false;
        Item.Insert();
    end;

    local procedure ItemFlag(ItemCode: Code[10]): Boolean
    var
        Item: Record "CG X005 Item";
    begin
        Item.Get(ItemCode);
        exit(Item."Flag");
    end;

    [Test]
    procedure FlagsScatteredQualifyingItemsOnly()
    var
        Flagger: Codeunit "CG X005 Flagger";
        Flagged: Integer;
    begin
        // [GIVEN] Five items in Code order: qualifying items sit in the
        // middle, separated by a non-qualifying item, and the LAST item
        // does not qualify.
        ClearItems();
        SeedItem('IT01', 5); // non-qualifying, first
        SeedItem('IT02', 50); // qualifying
        SeedItem('IT03', 5); // non-qualifying, splits the two qualifiers
        SeedItem('IT04', 60); // qualifying, not last
        SeedItem('IT05', 5); // non-qualifying, LAST
        Commit();

        // [WHEN] Flagging with Threshold 10
        Flagged := Flagger.FlagHighValues(10);

        // [THEN] Exactly the two qualifying items are reported as flagged
        Assert.AreEqual(2, Flagged, 'Two items should be reported as flagged');

        // [THEN] Every qualifying item is actually flagged in the database
        Assert.IsTrue(ItemFlag('IT02'), 'IT02 (Value 50 > 10) must be flagged');
        Assert.IsTrue(ItemFlag('IT04'), 'IT04 (Value 60 > 10) must be flagged');

        // [THEN] Every non-qualifying item is left untouched
        Assert.IsFalse(ItemFlag('IT01'), 'IT01 (Value 5) must stay unflagged');
        Assert.IsFalse(ItemFlag('IT03'), 'IT03 (Value 5) must stay unflagged');
        Assert.IsFalse(ItemFlag('IT05'), 'IT05 (Value 5) must stay unflagged');
    end;

    [Test]
    procedure FlagsAdjacentQualifiersAndRespectsThresholdBoundary()
    var
        Flagger: Codeunit "CG X005 Flagger";
        Flagged: Integer;
    begin
        // [GIVEN] A different distribution: two ADJACENT qualifiers at the
        // front, a boundary item whose Value exactly equals Threshold
        // (must not qualify), a qualifier second-to-last, and a
        // non-qualifying item LAST.
        ClearItems();
        SeedItem('IT11', 100); // qualifying, first
        SeedItem('IT12', 100); // qualifying, adjacent to IT11
        SeedItem('IT13', 10); // non-qualifying: Value equals Threshold exactly
        SeedItem('IT14', 200); // qualifying, second-to-last
        SeedItem('IT15', 1); // non-qualifying, LAST
        Commit();

        // [WHEN] Flagging with Threshold 10
        Flagged := Flagger.FlagHighValues(10);

        // [THEN] Exactly the three qualifying items are reported as flagged
        Assert.AreEqual(3, Flagged, 'Three items should be reported as flagged');

        // [THEN] Every qualifying item is actually flagged in the database
        Assert.IsTrue(ItemFlag('IT11'), 'IT11 (Value 100 > 10) must be flagged');
        Assert.IsTrue(ItemFlag('IT12'), 'IT12 (Value 100 > 10) must be flagged');
        Assert.IsTrue(ItemFlag('IT14'), 'IT14 (Value 200 > 10) must be flagged');

        // [THEN] The boundary item (Value = Threshold) is NOT flagged
        Assert.IsFalse(
          ItemFlag('IT13'), 'IT13 (Value = Threshold) must not be flagged');

        // [THEN] The trailing non-qualifying item is left untouched
        Assert.IsFalse(ItemFlag('IT15'), 'IT15 (Value 1) must stay unflagged');
    end;
}
