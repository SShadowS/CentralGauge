codeunit 89298 "CG-AL-X104 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (project convention, SOAP runner), so every test clears both tables
    // before seeding its own rows.

    local procedure SeedList(ListCode: Code[20]; Description: Text[100]; LineCount: Integer)
    var
        List: Record "CG X104 Price List";
    begin
        List.Init();
        List.Code := ListCode;
        List.Description := CopyStr(Description, 1, MaxStrLen(List.Description));
        List."Line Count" := LineCount;
        List.Insert();
    end;

    local procedure SeedLine(ListCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; UnitPrice: Decimal)
    var
        Line: Record "CG X104 Price List Line";
    begin
        Line.Init();
        Line."List Code" := ListCode;
        Line."Line No." := LineNo;
        Line."Item No." := ItemNo;
        Line."Unit Price" := UnitPrice;
        Line.Insert();
    end;

    local procedure LineCountFor(ListCode: Code[20]): Integer
    var
        Line: Record "CG X104 Price List Line";
    begin
        Line.SetRange("List Code", ListCode);
        exit(Line.Count());
    end;

    local procedure FindLineByItem(ListCode: Code[20]; ItemNo: Code[20]; var Line: Record "CG X104 Price List Line"): Boolean
    begin
        Line.SetRange("List Code", ListCode);
        Line.SetRange("Item No.", ItemNo);
        exit(Line.FindFirst());
    end;

    local procedure HappyPayload(): Text
    begin
        exit('{"items":[{"itemNo":"ITEM-A","unitPrice":12.5},{"itemNo":"ITEM-B","unitPrice":7.25},{"itemNo":"ITEM-C","unitPrice":3}]}');
    end;

    local procedure EmptyItemsPayload(): Text
    begin
        exit('{"items":[]}');
    end;

    local procedure PartiallyValidPayload(): Text
    begin
        exit('{"items":[{"itemNo":"FEED-A","unitPrice":1},{"itemNo":"FEED-B","unitPrice":2},{"itemNo":"FEED-BAD"}]}');
    end;

    local procedure SingleItemPayload(): Text
    begin
        exit('{"items":[{"itemNo":"ITEM-SOLO","unitPrice":42}]}');
    end;

    [Test]
    procedure HappyPathReplacesAllLines()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        NewLine: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        SeedList('P1', 'Spring catalog', 1);
        SeedLine('P1', 10000, 'OLD-ITEM', 1.11);

        Sync.SyncPriceList('P1', HappyPayload());

        List.Get('P1');
        Assert.AreEqual(3, List."Line Count", 'The cached line count must match the number of items the feed sent');
        Assert.AreEqual(3, LineCountFor('P1'), 'The list must hold exactly the lines the feed sent');
        Assert.IsFalse(FindLineByItem('P1', 'OLD-ITEM', NewLine), 'A line the feed no longer lists must not survive the sync');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-A', NewLine), 'ITEM-A from the feed must be present');
        Assert.AreEqual(12.5, NewLine."Unit Price", 'ITEM-A must carry the feed''s price');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-B', NewLine), 'ITEM-B from the feed must be present');
        Assert.AreEqual(7.25, NewLine."Unit Price", 'ITEM-B must carry the feed''s price');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-C', NewLine), 'ITEM-C from the feed must be present');
        Assert.AreEqual(3, NewLine."Unit Price", 'ITEM-C must carry the feed''s price');
    end;

    [Test]
    procedure AResponseWithNoItemsIsRejectedAndPricesSurvive()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        SeedList('P1', 'Spring catalog', 2);
        SeedLine('P1', 10000, 'ITEM-A', 5.55);
        SeedLine('P1', 20000, 'ITEM-B', 7.77);
        Commit();

        asserterror Sync.SyncPriceList('P1', EmptyItemsPayload());

        List.Get('P1');
        Assert.AreEqual(2, List."Line Count", 'A feed response listing no items must not erase the cached line count');
        Assert.AreEqual(2, LineCountFor('P1'), 'A feed response listing no items must not erase the existing lines');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-A', Line), 'ITEM-A must survive a response listing no items');
        Assert.AreEqual(5.55, Line."Unit Price", 'ITEM-A''s price must be unchanged');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-B', Line), 'ITEM-B must survive a response listing no items');
        Assert.AreEqual(7.77, Line."Unit Price", 'ITEM-B''s price must be unchanged');
    end;

    [Test]
    procedure APartiallyValidResponseReplacesNothing()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        SeedList('P1', 'Spring catalog', 2);
        SeedLine('P1', 10000, 'ITEM-A', 5.55);
        SeedLine('P1', 20000, 'ITEM-B', 7.77);
        Commit();

        asserterror Sync.SyncPriceList('P1', PartiallyValidPayload());

        List.Get('P1');
        Assert.AreEqual(2, List."Line Count", 'A response that fails partway through must not leave a partial replacement');
        Assert.AreEqual(2, LineCountFor('P1'), 'A response that fails partway through must not leave a partial replacement');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-A', Line), 'The original item must survive a response that fails partway through');
        Assert.AreEqual(5.55, Line."Unit Price", 'The original item''s price must be unchanged by a response that fails partway through');
        Assert.IsFalse(FindLineByItem('P1', 'FEED-A', Line), 'No item from a response that fails partway through may appear');
        Assert.IsFalse(FindLineByItem('P1', 'FEED-B', Line), 'No item from a response that fails partway through may appear');
    end;

    [Test]
    procedure SingleItemResponseStillReplacesTheList()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        SeedList('P1', 'Spring catalog', 2);
        SeedLine('P1', 10000, 'ITEM-A', 5.55);
        SeedLine('P1', 20000, 'ITEM-B', 7.77);

        Sync.SyncPriceList('P1', SingleItemPayload());

        List.Get('P1');
        Assert.AreEqual(1, List."Line Count", 'A single-item response must still replace the list, unlike one listing no items');
        Assert.AreEqual(1, LineCountFor('P1'), 'A single-item response must still replace the list, unlike one listing no items');
        Assert.IsTrue(FindLineByItem('P1', 'ITEM-SOLO', Line), 'The single item from the response must be present');
        Assert.AreEqual(42, Line."Unit Price", 'The single item must carry the response''s price');
        Assert.IsFalse(FindLineByItem('P1', 'ITEM-A', Line), 'A single-item response must still remove lines it no longer lists');
    end;

    [Test]
    procedure ASecondPriceListIsUntouchedByAScopedSync()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        SeedList('P1', 'Spring catalog', 1);
        SeedLine('P1', 10000, 'OLD-ITEM', 1.11);
        SeedList('P2', 'Autumn catalog', 1);
        SeedLine('P2', 10000, 'OTHER-ITEM', 9.99);

        Sync.SyncPriceList('P1', HappyPayload());

        List.Get('P2');
        Assert.AreEqual(1, List."Line Count", 'Syncing one price list must not touch another list''s cached count');
        Assert.AreEqual(1, LineCountFor('P2'), 'Syncing one price list must not touch another list''s lines');
        Assert.IsTrue(FindLineByItem('P2', 'OTHER-ITEM', Line), 'The other list''s line must survive');
        Assert.AreEqual(9.99, Line."Unit Price", 'The other list''s price must be unchanged');
    end;

    [Test]
    procedure SyncingAnUnknownPriceListIsRejected()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();

        asserterror Sync.SyncPriceList('NOPE', '');

        Assert.AreEqual(0, LineCountFor('NOPE'), 'A sync against an unknown price list must not create any lines');
    end;
}
