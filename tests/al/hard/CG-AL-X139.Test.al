codeunit 89359 "CG-AL-X139 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        AdjLine: Record "CG X139 Adjustment Line";
        LedgerEntry: Record "CG X139 Item Ledger Entry";
        Balance: Record "CG X139 Item Balance";
    begin
        AdjLine.DeleteAll();
        LedgerEntry.DeleteAll();
        Balance.DeleteAll();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; AdjType: Enum "CG X139 Adjustment Type"; ItemNo: Code[20]; LocationCode: Code[10]; NewLocationCode: Code[10]; Quantity: Decimal)
    var
        AdjLine: Record "CG X139 Adjustment Line";
    begin
        AdjLine.Init();
        AdjLine."Document No." := DocumentNo;
        AdjLine."Line No." := LineNo;
        AdjLine."Adjustment Type" := AdjType;
        AdjLine."Item No." := ItemNo;
        AdjLine."Location Code" := LocationCode;
        AdjLine."New Location Code" := NewLocationCode;
        AdjLine.Quantity := Quantity;
        AdjLine.Insert();
    end;

    local procedure SeedBalance(ItemNo: Code[20]; LocationCode: Code[10]; Quantity: Decimal)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        Balance.Init();
        Balance."Item No." := ItemNo;
        Balance."Location Code" := LocationCode;
        Balance.Quantity := Quantity;
        Balance.Insert();
    end;

    local procedure AssertBalance(ItemNo: Code[20]; LocationCode: Code[10]; ExpectedQuantity: Decimal; MessagePrefix: Text)
    var
        Balance: Record "CG X139 Item Balance";
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        Assert.IsTrue(Balance.Get(ItemNo, LocationCode), MessagePrefix + ' - balance record exists');
        Assert.AreEqual(ExpectedQuantity, Balance.Quantity, MessagePrefix + ' - balance quantity');
        Assert.AreEqual(ExpectedQuantity, Poster.GetBalance(ItemNo, LocationCode), MessagePrefix + ' - balance via getter');
    end;

    local procedure AssertNoBalanceRecord(ItemNo: Code[20]; LocationCode: Code[10]; MessagePrefix: Text)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        Assert.IsFalse(Balance.Get(ItemNo, LocationCode), MessagePrefix + ' - no balance record expected');
    end;

    local procedure AssertLedgerEntry(DocumentNo: Code[20]; LineNo: Integer; LocationCode: Code[10]; ItemNo: Code[20]; ExpectedQuantity: Decimal; MessagePrefix: Text)
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.SetRange("Document No.", DocumentNo);
        LedgerEntry.SetRange("Line No.", LineNo);
        LedgerEntry.SetRange("Location Code", LocationCode);
        LedgerEntry.SetRange(Quantity, ExpectedQuantity);
        Assert.IsTrue(LedgerEntry.FindFirst(), MessagePrefix + ' - ledger entry exists with the expected quantity');
        Assert.AreEqual(ItemNo, LedgerEntry."Item No.", MessagePrefix + ' - ledger entry item no');
    end;

    local procedure AssertLedgerEntryCountForLine(DocumentNo: Code[20]; LineNo: Integer; ExpectedCount: Integer; MessagePrefix: Text)
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.SetRange("Document No.", DocumentNo);
        LedgerEntry.SetRange("Line No.", LineNo);
        Assert.AreEqual(ExpectedCount, LedgerEntry.Count(), MessagePrefix + ' - number of ledger entries for the line');
    end;

    [Test]
    procedure IncreaseLineAddsQuantityToExistingBalance()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM1', 'BLUE', 10);
        SeedBalance('SENTINEL', 'SENTLOC', 999);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM1', 'BLUE', '', 5);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM1', 5, 'An increase line logs a positive entry');
        AssertBalance('ITM1', 'BLUE', 15, 'An increase line adds to the existing balance');
        AssertBalance('SENTINEL', 'SENTLOC', 999, 'An unrelated balance must not be touched by posting a different item');
    end;

    [Test]
    procedure DecreaseLineSubtractsQuantityFromBalance()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM2', 'BLUE', 20);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Decrease, 'ITM2', 'BLUE', '', 8);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM2', -8, 'A decrease line logs a negative entry');
        AssertBalance('ITM2', 'BLUE', 12, 'A decrease line subtracts from the existing balance');
    end;

    [Test]
    procedure RevalueLineSetsBalanceToTheCountedQuantity()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM3', 'BLUE', 30);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Revalue, 'ITM3', 'BLUE', '', 50);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM3', 20, 'A revalue line logs only the difference from the prior balance');
        AssertBalance('ITM3', 'BLUE', 50, 'A revalue line sets the balance to the counted quantity, not to the difference');
    end;

    [Test]
    procedure RevalueLineWithNoPriorBalanceTreatsCurrentQuantityAsZero()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Revalue, 'ITM4', 'BLUE', '', 12);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM4', 12, 'A revalue line with no prior balance logs the full counted quantity');
        AssertBalance('ITM4', 'BLUE', 12, 'A revalue line with no prior balance sets it to the counted quantity');
    end;

    [Test]
    procedure TransferLineMovesQuantityBetweenTwoLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM5', 'BLUE', 40);
        SeedBalance('ITM5', 'RED', 5);
        SeedBalance('SENTINEL', 'SENTLOC', 999);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM5', 'BLUE', 'RED', 15);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM5', -15, 'A transfer line logs a negative entry at the source location');
        AssertLedgerEntry('DOC1', 10, 'RED', 'ITM5', 15, 'A transfer line logs a positive entry at the destination location');
        AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A transfer line logs exactly one entry per location');
        AssertBalance('ITM5', 'BLUE', 25, 'A transfer line reduces the source location''s balance');
        AssertBalance('ITM5', 'RED', 20, 'A transfer line increases the destination location''s balance');
        AssertBalance('SENTINEL', 'SENTLOC', 999, 'An unrelated balance must not be touched by posting a transfer');
    end;

    [Test]
    procedure TransferLineWithZeroQuantityStillRecordsBothLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM6', 'BLUE', 7);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM6', 'BLUE', 'RED', 0);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM6', 0, 'A zero-quantity transfer still logs the source location');
        AssertLedgerEntry('DOC1', 10, 'RED', 'ITM6', 0, 'A zero-quantity transfer still logs the destination location');
        AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A zero-quantity transfer still logs one entry per location');
        AssertBalance('ITM6', 'BLUE', 7, 'A zero-quantity transfer leaves the source balance unchanged');
        AssertBalance('ITM6', 'RED', 0, 'A zero-quantity transfer still records the destination location''s balance');
    end;

    [Test]
    procedure TransferLineBetweenTheSameLocationNetsToNoChange()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM7', 'BLUE', 22);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM7', 'BLUE', 'BLUE', 9);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM7', -9, 'A same-location transfer still logs the outgoing move');
        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM7', 9, 'A same-location transfer still logs the incoming move');
        AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A same-location transfer still logs one entry per side of the move');
        AssertBalance('ITM7', 'BLUE', 22, 'A same-location transfer leaves the net balance unchanged');
    end;

    [Test]
    procedure PostAdjustmentsOnlyPostsLinesForTheRequestedDocument()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM8', 'BLUE', '', 6);
        SeedLine('DOC2', 10, "CG X139 Adjustment Type"::Increase, 'ITM8', 'RED', '', 40);

        Poster.PostAdjustments('DOC1');

        AssertBalance('ITM8', 'BLUE', 6, 'The requested document''s line posts');
        AssertNoBalanceRecord('ITM8', 'RED', 'A different document''s line must not be posted');
        AssertLedgerEntryCountForLine('DOC2', 10, 0, 'A different document''s line must not log any entry');
    end;

    [Test]
    procedure MixedDocumentPostsEveryLineTypeCorrectly()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM9A', 'BLUE', 10);
        SeedBalance('ITM9B', 'BLUE', 20);
        SeedBalance('ITM9C', 'BLUE', 30);
        SeedBalance('ITM9D', 'BLUE', 40);
        SeedBalance('ITM9D', 'RED', 4);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM9A', 'BLUE', '', 5);
        SeedLine('DOC1', 20, "CG X139 Adjustment Type"::Decrease, 'ITM9B', 'BLUE', '', 5);
        SeedLine('DOC1', 30, "CG X139 Adjustment Type"::Revalue, 'ITM9C', 'BLUE', '', 100);
        SeedLine('DOC1', 40, "CG X139 Adjustment Type"::Transfer, 'ITM9D', 'BLUE', 'RED', 10);

        Poster.PostAdjustments('DOC1');

        AssertBalance('ITM9A', 'BLUE', 15, 'The increase line on the mixed document still posts correctly');
        AssertBalance('ITM9B', 'BLUE', 15, 'The decrease line on the mixed document still posts correctly');
        AssertBalance('ITM9C', 'BLUE', 100, 'The revalue line on the mixed document still posts correctly');
        AssertBalance('ITM9D', 'BLUE', 30, 'The transfer line''s source location posts correctly on the mixed document');
        AssertBalance('ITM9D', 'RED', 14, 'The transfer line''s destination location posts correctly on the mixed document');
        AssertLedgerEntryCountForLine('DOC1', 40, 2, 'The transfer line on the mixed document still logs one entry per location');
    end;

    [Test]
    procedure GetBalanceWithNoRecordedQuantityReturnsZero()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        Assert.AreEqual(0, Poster.GetBalance('ITM-NONE', 'NOWHERE'), 'An item and location with no recorded balance reports zero');
    end;

    [Test]
    procedure TwoTransferLinesOnOneDocumentBothPostIndependently()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAll();
        SeedBalance('ITM10', 'BLUE', 50);
        SeedBalance('ITM10', 'RED', 0);
        SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM10', 'BLUE', 'RED', 12);
        SeedLine('DOC1', 20, "CG X139 Adjustment Type"::Transfer, 'ITM10', 'BLUE', 'RED', 8);

        Poster.PostAdjustments('DOC1');

        AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM10', -12, 'The first transfer line logs its own source entry');
        AssertLedgerEntry('DOC1', 20, 'BLUE', 'ITM10', -8, 'The second transfer line logs its own source entry, not the first line''s');
        AssertLedgerEntry('DOC1', 10, 'RED', 'ITM10', 12, 'The first transfer line logs its own destination entry');
        AssertLedgerEntry('DOC1', 20, 'RED', 'ITM10', 8, 'The second transfer line logs its own destination entry, not the first line''s');
        AssertBalance('ITM10', 'BLUE', 30, 'Both transfer lines'' outgoing moves accumulate on the source balance');
        AssertBalance('ITM10', 'RED', 20, 'Both transfer lines'' incoming moves accumulate on the destination balance');
    end;
}
