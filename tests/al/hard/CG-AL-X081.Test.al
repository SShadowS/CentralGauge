codeunit 88834 "CG-AL-X081 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Any: Codeunit Any;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows. Grades are
    // random text rather than fixed literals so a fix cannot special-case a
    // hardcoded value.

    local procedure Reset()
    var
        OrderLine: Record "CG X081 Order Line";
        Item: Record "CG X081 Item";
    begin
        OrderLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure CreateItem(var Item: Record "CG X081 Item"; No: Code[20]; Grade: Code[10])
    begin
        Item.Init();
        Item."No." := No;
        Item."Quality Grade" := Grade;
        Item.Insert(true);
    end;

    local procedure RandomGrade(): Code[10]
    begin
        exit(CopyStr(Any.AlphabeticText(10), 1, 10));
    end;

    local procedure CreateLine(var OrderLine: Record "CG X081 Order Line"; EntryNo: Integer; ItemNo: Code[20])
    begin
        OrderLine.Init();
        OrderLine."Entry No." := EntryNo;
        OrderLine.Insert(true);
        OrderLine.Validate("Item No.", ItemNo);
        OrderLine.Modify(true);
    end;

    [Test]
    procedure NewLineForAGradedItemGetsTheGrade()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Grade: Code[10];
    begin
        Reset();
        Grade := RandomGrade();
        CreateItem(Item, 'ITEM-A', Grade);

        CreateLine(OrderLine, 1, Item."No.");

        Assert.AreEqual(Grade, OrderLine."Quality Grade",
            'Expected validating "Item No." with a graded item to copy that item''s grade onto the line');
    end;

    [Test]
    procedure NewLineForAGradelessItemStaysBlank()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        Reset();
        CreateItem(Item, 'ITEM-B', '');

        CreateLine(OrderLine, 2, Item."No.");

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to stay blank when the item on it has none');
    end;

    [Test]
    procedure RevalidatingToAnotherGradedItemOverwritesTheGrade()
    var
        FirstItem: Record "CG X081 Item";
        SecondItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
    begin
        Reset();
        CreateItem(FirstItem, 'ITEM-C', RandomGrade());
        SecondGrade := RandomGrade();
        CreateItem(SecondItem, 'ITEM-D', SecondGrade);
        CreateLine(OrderLine, 3, FirstItem."No.");

        OrderLine.Validate("Item No.", SecondItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." to another graded item to overwrite the line''s grade with the new item''s grade');
    end;

    [Test]
    procedure RevalidatingToAGradelessItemClearsTheLine()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        Reset();
        CreateItem(GradedItem, 'ITEM-E', RandomGrade());
        CreateItem(GradelessItem, 'ITEM-F', '');
        CreateLine(OrderLine, 4, GradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to an item with no grade - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure ClearingTheItemNoAlsoClearsTheGrade()
    var
        GradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        Reset();
        CreateItem(GradedItem, 'ITEM-M', RandomGrade());
        CreateLine(OrderLine, 8, GradedItem."No.");

        OrderLine.Validate("Item No.", '');
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to blank - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure RevalidatingBackToAGradedItemAfterClearingSetsTheNewGrade()
    var
        FirstGradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        SecondGradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
    begin
        Reset();
        CreateItem(FirstGradedItem, 'ITEM-G', RandomGrade());
        CreateItem(GradelessItem, 'ITEM-H', '');
        SecondGrade := RandomGrade();
        CreateItem(SecondGradedItem, 'ITEM-I', SecondGrade);
        CreateLine(OrderLine, 5, FirstGradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);
        OrderLine.Validate("Item No.", SecondGradedItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." back to a graded item after a gradeless item to set the new item''s grade');
    end;

    [Test]
    procedure AssigningItemValuesDirectlyAlsoClearsAStaleGrade()
    var
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
    begin
        Reset();
        CreateItem(GradelessItem, 'ITEM-J', '');
        OrderLine.Init();
        OrderLine."Entry No." := 6;
        OrderLine."Item No." := GradelessItem."No.";
        OrderLine."Quality Grade" := 'STALE';
        OrderLine.Insert(true);

        LineDefaultsMgt.AssignItemValues(OrderLine);
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected assigning item values for a line pointed at a gradeless item to leave the line''s grade blank, matching what that item carries');
    end;

    [Test]
    procedure UnrelatedLinesAreNeverTouched()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        OtherLine: Record "CG X081 Order Line";
    begin
        Reset();
        CreateItem(GradedItem, 'ITEM-K', RandomGrade());
        CreateItem(GradelessItem, 'ITEM-L', '');

        OtherLine.Init();
        OtherLine."Entry No." := 100;
        OtherLine."Quality Grade" := 'SENTINEL9';
        OtherLine.Insert(true);

        CreateLine(OrderLine, 7, GradedItem."No.");
        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        OtherLine.Get(100);
        Assert.AreEqual('SENTINEL9', Format(OtherLine."Quality Grade"),
            'Expected a line never re-validated in this test to keep its original grade untouched');
    end;
}
