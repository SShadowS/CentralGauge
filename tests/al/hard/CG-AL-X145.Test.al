codeunit 89365 "CG-AL-X145 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    // ==== CG X139 (adjustment posting) helpers ====

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

    // ==== CG X107 (deal posting / reference stamping) helpers ====
    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows.

    local procedure Reset()
    var
        DealHeader: Record "CG X107 Deal Header";
        PostedDeal: Record "CG X107 Posted Deal";
    begin
        DealHeader.DeleteAll();
        PostedDeal.DeleteAll();
    end;

    local procedure SeedDeal(No: Code[20]; DealReference: Text[30]; Amount: Decimal)
    var
        DealHeader: Record "CG X107 Deal Header";
    begin
        DealHeader.Init();
        DealHeader."No." := No;
        DealHeader."Deal Reference" := DealReference;
        DealHeader.Amount := Amount;
        DealHeader.Insert();
    end;

    [Test]
    procedure PostedDealCarriesTheDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D001', 'REF-ALPHA-0001-XXXXXXXXXXXXXX', 100);

        Poster.PostDeal('D001');

        PostedDeal.Get('D001');
        Assert.AreEqual('REF-ALPHA-0001-XXXXXXXXXXXXXX', PostedDeal."Deal Reference",
            'Expected the posted deal to carry the deal reference recorded at posting time');
    end;

    [Test]
    procedure PostedDealCarriesADifferentDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D002', 'REF-BETA-9999-YYYYYYYYYYYYYYY', 250);

        Poster.PostDeal('D002');

        PostedDeal.Get('D002');
        Assert.AreEqual('REF-BETA-9999-YYYYYYYYYYYYYYY', PostedDeal."Deal Reference",
            'Expected the posted deal to carry this deal header''s own reference');
    end;

    [Test]
    procedure PostingKeepsTheAmountThePosterAssigns()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        SeedDeal('D003', 'REF-GAMMA-1234-ZZZZZZZZZZZZZZ', 777.5);

        Poster.PostDeal('D003');

        PostedDeal.Get('D003');
        Assert.AreEqual(777.5, PostedDeal.Amount,
            'Expected the posted deal to keep the amount recorded when it was posted');
    end;

    [Test]
    procedure PostingOneDealDoesNotChangeAnotherAlreadyPostedDeal()
    var
        OtherPostedDeal: Record "CG X107 Posted Deal";
        NewPostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        Reset();
        OtherPostedDeal.Init();
        OtherPostedDeal."No." := 'EXIST';
        OtherPostedDeal."Deal Reference" := 'REF-EXISTING-SENTINEL-000000';
        OtherPostedDeal.Amount := 555;
        OtherPostedDeal.Insert();

        SeedDeal('D004', 'REF-DELTA-4444-WWWWWWWWWWWWWW', 42);
        Poster.PostDeal('D004');

        OtherPostedDeal.Get('EXIST');
        Assert.AreEqual('REF-EXISTING-SENTINEL-000000', OtherPostedDeal."Deal Reference",
            'Expected an already-posted deal to keep its own deal reference when another deal is posted');
        Assert.AreEqual(555, OtherPostedDeal.Amount,
            'Expected an already-posted deal to keep its own amount when another deal is posted');

        NewPostedDeal.Get('D004');
        Assert.AreEqual('REF-DELTA-4444-WWWWWWWWWWWWWW', NewPostedDeal."Deal Reference",
            'Expected the newly posted deal to carry its own deal reference');
    end;

    // ==== CG X121 (billing-line templates) helpers ====
    // Companies are enumerated at runtime, never hardcoded, and every test
    // that touches the other company deletes what it seeded there BEFORE
    // asserting anything, then Commit()s that delete - so the cleanup is
    // durable even if a later assertion in the same test fails and raises
    // an error.

    local procedure CreateContract(var Header: Record "CG X121 Contract Header"; No: Code[20]; PlanCode: Code[10]; RegionCode: Code[10]; ContactName: Text[50])
    var
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.Init();
        Header."No." := No;
        Header."Plan Code" := PlanCode;
        Header."Region Code" := RegionCode;
        Header."Contact Name" := ContactName;
        Header.Insert();
        ContractMgt.GenerateInitialLines(Header);
    end;

    local procedure AssertAllLinesHaveAmount(ContractNo: Code[20]; ExpectedAmount: Decimal; Msg: Text)
    var
        Line: Record "CG X121 Contract Line";
        LineCount: Integer;
    begin
        Line.SetRange("Contract No.", ContractNo);
        if Line.FindSet() then
            repeat
                Assert.AreEqual(ExpectedAmount, Line.Amount, Msg);
                LineCount += 1;
            until Line.Next() = 0;
        Assert.AreEqual(3, LineCount, 'Expected exactly three billing lines for the contract');
    end;

    [Test]
    procedure PlanCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C001', 'BASIC', 'EAST', 'Alice');

        Header.Validate("Plan Code", 'PLUS');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C001');

        AssertAllLinesHaveAmount('C001', 200, 'Billing lines must reflect the new plan after the lines are refreshed');
        Assert.AreEqual(6, Header."Last Line Entry No.", 'Refreshing the billing lines after a plan change must rebuild them, not just adjust their amounts in place');

        Line.SetRange("Contract No.", 'C001');
        Assert.IsTrue(Line.FindSet(), 'The contract must still have billing lines after the plan change');
        Assert.AreEqual(1, Line."Period No.", 'The first billing line must keep its position in the billing schedule after the lines are refreshed');
        Line.FindLast();
        Assert.AreEqual(3, Line."Period No.", 'The third billing line must keep its position in the billing schedule after the lines are refreshed');
    end;

    [Test]
    procedure RegionCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C002', 'BASIC', 'EAST', 'Bob');

        Header.Validate("Region Code", 'WEST');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C002');

        AssertAllLinesHaveAmount('C002', 110, 'Billing lines must reflect the new region after the lines are refreshed');
    end;

    [Test]
    procedure ContactNameChangeDoesNotRebuildLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        CreateContract(Header, 'C003', 'BASIC', 'EAST', 'Carol');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must exist right after it is created');
        Line.Amount := 777;
        Line.Modify();

        Header.Validate("Contact Name", 'Caroline');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C003');

        Assert.AreEqual(3, Header."Last Line Entry No.", 'The billing lines must not be rebuilt when only the contact name changes');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(777, Line.Amount, 'A billing line''s recorded amount must survive when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 2), 'Billing line 2 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The second billing line must be untouched when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 3), 'Billing line 3 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The third billing line must be untouched when only the contact name changes');
    end;

    [Test]
    procedure PlanCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        CreateContract(HeaderA, 'C004A', 'BASIC', 'EAST', 'Dave');
        CreateContract(HeaderB, 'C004B', 'PLUS', 'NORTH', 'Erin');

        HeaderA.Validate("Plan Code", 'PREMIUM');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C004B');

        AssertAllLinesHaveAmount('C004A', 300, 'Billing lines for the edited contract must reflect its new plan');
        AssertAllLinesHaveAmount('C004B', 240, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure RegionCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        CreateContract(HeaderA, 'C005A', 'PLUS', 'EAST', 'Frank');
        CreateContract(HeaderB, 'C005B', 'PLUS', 'WEST', 'Grace');

        HeaderA.Validate("Region Code", 'NORTH');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C005B');

        AssertAllLinesHaveAmount('C005A', 240, 'Billing lines for the edited contract must reflect its new region');
        AssertAllLinesHaveAmount('C005B', 220, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure PricingFormulaAppliesAcrossPlanAndRegionCodes()
    var
        Header: Record "CG X121 Contract Header";
        PlanHeader: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
        RegionCodes: List of [Code[10]];
        ExpectedRegionFactors: List of [Decimal];
        PlanCodes: List of [Code[10]];
        ExpectedPlanRates: List of [Decimal];
        Index: Integer;
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        RegionCodes.Add('WEST');
        RegionCodes.Add('NORTH');
        RegionCodes.Add('EAST');
        RegionCodes.Add('SOUTH');
        ExpectedRegionFactors.Add(1.1);
        ExpectedRegionFactors.Add(1.2);
        ExpectedRegionFactors.Add(1.0);
        ExpectedRegionFactors.Add(1.0);

        CreateContract(Header, 'C006', 'PLUS', 'EAST', 'Holly');

        for Index := 1 to RegionCodes.Count() do begin
            Header.Get('C006');
            Header.Validate("Region Code", RegionCodes.Get(Index));
            Header.Modify();
            ContractMgt.RefreshLines(Header);
            AssertAllLinesHaveAmount('C006', 200 * ExpectedRegionFactors.Get(Index), 'Billing lines must reflect the region currently on the header');
        end;

        PlanCodes.Add('GOLD');
        ExpectedPlanRates.Add(100);

        CreateContract(PlanHeader, 'C007', 'BASIC', 'EAST', 'Ivan');

        for Index := 1 to PlanCodes.Count() do begin
            PlanHeader.Get('C007');
            PlanHeader.Validate("Plan Code", PlanCodes.Get(Index));
            PlanHeader.Modify();
            ContractMgt.RefreshLines(PlanHeader);
            AssertAllLinesHaveAmount('C007', ExpectedPlanRates.Get(Index) * 1.0, 'Billing lines must reflect the plan currently on the header');
        end;
    end;

    // ==== CG X128 (per-company vs. shared settings) helpers ====
    // Companies are enumerated at runtime, never hardcoded, and every test
    // that touches the other company deletes what it seeded there BEFORE
    // asserting anything, then Commit()s that delete - so the cleanup is
    // durable even if a later assertion in the same test fails and raises
    // an error (an error only rolls back the CURRENT, still-open
    // transaction; a prior Commit() cannot be undone by it). A defensive
    // clear also runs at the START of every cross-company test in case a
    // still-earlier run was aborted before it could self-heal.

    local procedure GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure ClearHomeSetup()
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.DeleteAll();
    end;

    local procedure ClearOtherCompanySetup(OtherName: Text[30])
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Setup.DeleteAll();
    end;

    local procedure ClearHomeGroupRate()
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.DeleteAll();
    end;

    local procedure ClearOtherCompanyGroupRate(OtherName: Text[30])
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        GroupRate.DeleteAll();
    end;

    local procedure SeedOtherCompanySetup(OtherName: Text[30]; Grace: Integer; Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
        Found: Boolean;
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if not Found then begin
            Setup.Init();
            Setup."Primary Key" := 'SETUP';
        end;
        Setup."Grace Period Days" := Grace;
        Setup."Late Fee Percent" := Fee;
        if Found then
            Setup.Modify()
        else
            Setup.Insert();
    end;

    local procedure ReadOtherCompanySetup(OtherName: Text[30]; var Found: Boolean; var Grace: Integer; var Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if Found then begin
            Grace := Setup."Grace Period Days";
            Fee := Setup."Late Fee Percent";
        end;
    end;

    local procedure ReadOtherCompanyGroupRate(OtherName: Text[30]; CurrencyCode: Code[10]; var Found: Boolean; var Rate: Decimal)
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        Found := GroupRate.Get(CurrencyCode);
        if Found then
            Rate := GroupRate."Intercompany Rate";
    end;

    [Test]
    procedure ChangingOneCompanysSettingsDoesNotOverwriteAnotherCompanysOwnSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        // The other company already configured its own settings.
        SeedOtherCompanySetup(OtherName, 30, 2.5);

        // The home company independently configures its own settings.
        Policy.SetGracePeriodDays(45);
        Policy.SetLateFeePercent(9.9);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        // Clean up both companies before asserting anything, and commit that
        // cleanup, so this test never leaves data behind in the other
        // company regardless of whether the assertions below pass or fail.
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(45, HomeGraceAfter,
            'Expected the home company grace period to reflect what was just configured for it');
        Assert.AreEqual(9.9, HomeFeeAfter,
            'Expected the home company late fee percentage to reflect what was just configured for it');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to still have its own collection settings');
        Assert.AreEqual(30, OtherGraceAfter,
            'Expected the other company grace period to remain the value it configured for itself, unaffected by the home company change');
        Assert.AreEqual(2.5, OtherFeeAfter,
            'Expected the other company late fee percentage to remain the value it configured for itself, unaffected by the home company change');
    end;

    [Test]
    procedure AnotherCompanyConfiguringItsOwnSettingsDoesNotChangeTheHomeCompanysSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        // The home company configures its own settings first.
        Policy.SetGracePeriodDays(21);
        Policy.SetLateFeePercent(3.3);

        // A different company now configures its own, different settings.
        SeedOtherCompanySetup(OtherName, 60, 6.6);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(21, HomeGraceAfter,
            'Expected the home company grace period to remain the value it configured for itself, unaffected by another company''s change');
        Assert.AreEqual(3.3, HomeFeeAfter,
            'Expected the home company late fee percentage to remain the value it configured for itself, unaffected by another company''s change');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to have its own collection settings');
        Assert.AreEqual(60, OtherGraceAfter,
            'Expected the other company grace period to reflect what it configured for itself');
        Assert.AreEqual(6.6, OtherFeeAfter,
            'Expected the other company late fee percentage to reflect what it configured for itself');
    end;

    [Test]
    procedure TheIntercompanyRateIsVisibleAndIdenticalInEveryCompany()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
        OtherName: Text[30];
        HomeRateAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherRateAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeGroupRate();
        ClearOtherCompanyGroupRate(OtherName);
        Commit();

        // The rate is set once, from the home company, and must be the
        // same rate every company sees - it is not each company's own.
        Treasury.SetIntercompanyRate('EUR', 1.0937);

        HomeRateAfter := Treasury.GetIntercompanyRate('EUR');
        ReadOtherCompanyGroupRate(OtherName, 'EUR', OtherFoundAfter, OtherRateAfter);

        ClearHomeGroupRate();
        ClearOtherCompanyGroupRate(OtherName);
        Commit();

        Assert.AreEqual(1.0937, HomeRateAfter,
            'Expected the home company to see the intercompany rate that was just set');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to see the same intercompany rate record');
        Assert.AreEqual(1.0937, OtherRateAfter,
            'Expected the other company to see the exact same intercompany rate, since it is shared across every company by design');
    end;

    [Test]
    procedure SettingTheRateForOneCurrencyDoesNotAffectAnother()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
    begin
        ClearHomeGroupRate();

        Treasury.SetIntercompanyRate('EUR', 1.0937);
        Treasury.SetIntercompanyRate('USD', 1.0);

        Assert.AreEqual(1.0937, Treasury.GetIntercompanyRate('EUR'),
            'Expected the EUR rate to be unaffected by setting a different currency''s rate');
        Assert.AreEqual(1.0, Treasury.GetIntercompanyRate('USD'),
            'Expected the USD rate to reflect what was just set for it');
        Assert.AreEqual(0.0, Treasury.GetIntercompanyRate('GBP'),
            'Expected no intercompany rate for a currency that was never configured');

        ClearHomeGroupRate();
    end;

    [Test]
    procedure SettingAndReadingBackTheGracePeriodAndLateFeeInOneCompanyWorks()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        Policy2: Codeunit "CG X128 Collection Policy";
        Setup: Record "CG X128 Collection Setup";
    begin
        ClearHomeSetup();

        Policy.SetGracePeriodDays(50);
        Policy.SetLateFeePercent(4.25);

        Assert.AreEqual(50, Policy.GetGracePeriodDays(),
            'Expected the grace period to be exactly what was just configured');
        Assert.AreEqual(4.25, Policy.GetLateFeePercent(),
            'Expected the late fee percentage to be exactly what was just configured');
        Assert.AreEqual(50, Policy2.GetGracePeriodDays(),
            'Expected a separate part of the application to see the same grace period that was just configured, not a value private to whatever configured it');
        Setup.FindFirst();
        Assert.AreEqual(50, Setup."Grace Period Days",
            'Expected the configured grace period to be persisted on the collection settings record itself');
        Assert.AreEqual(4.25, Setup."Late Fee Percent",
            'Expected the configured late fee percentage to be persisted on the collection settings record itself');

        ClearHomeSetup();
    end;

    [Test]
    procedure TheSettingsDefaultWhenNothingHasBeenConfiguredYet()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();

        Assert.AreEqual(14, Policy.GetGracePeriodDays(),
            'Expected a default grace period before anything has been configured');
        Assert.AreEqual(1.5, Policy.GetLateFeePercent(),
            'Expected a default late fee percentage before anything has been configured');

        ClearHomeSetup();
    end;

    [Test]
    procedure IsOverdueRespectsTheGracePeriodBoundaryExactly()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();
        Policy.SetGracePeriodDays(14);

        Assert.IsFalse(Policy.IsOverdue(14),
            'Expected an invoice exactly at the grace period boundary to not yet be overdue');
        Assert.IsTrue(Policy.IsOverdue(15),
            'Expected an invoice one day past the grace period boundary to be overdue');

        ClearHomeSetup();
    end;

    [Test]
    procedure CalculateLateFeeAppliesThePercentageToTheAmount()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();
        Policy.SetLateFeePercent(5);

        Assert.AreEqual(10.0, Policy.CalculateLateFee(200),
            'Expected the late fee to be the configured percentage of the overdue amount');
        Assert.AreEqual(0.0, Policy.CalculateLateFee(0),
            'Expected no late fee on a zero overdue amount');

        Policy.SetLateFeePercent(2.5);
        Assert.AreEqual(5.0, Policy.CalculateLateFee(200),
            'Expected the late fee to scale with a different configured percentage on the same overdue amount');

        ClearHomeSetup();
    end;

    // ==== CG X145 (per-location network overview - glue) ====
    // The overview reads its numbers straight from the same balances the
    // adjustment posting tests above pin, so a rewrite that has the overview
    // compute its own numbers from the adjustment lines instead cannot pass
    // both this section and the balance assertions further up.

    [Test]
    procedure NetworkOverviewReflectsIncreaseAndDecreaseAtEachLocation()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
        Overview: Codeunit "CG X145 Network Overview";
    begin
        ClearAll();
        SeedBalance('ITM145A', 'BLUE', 10);
        SeedBalance('ITM145A', 'RED', 4);
        SeedBalance('SENTINEL145', 'SENTLOC', 500);
        SeedLine('DOC145A', 10, "CG X139 Adjustment Type"::Increase, 'ITM145A', 'BLUE', '', 6);
        SeedLine('DOC145A', 20, "CG X139 Adjustment Type"::Decrease, 'ITM145A', 'RED', '', 1);

        Poster.PostAdjustments('DOC145A');

        Assert.AreEqual(16, Overview.GetLocationTotalQuantity('ITM145A', 'BLUE'),
            'Expected the overview to reflect the increase at one of the item''s locations');
        Assert.AreEqual(3, Overview.GetLocationTotalQuantity('ITM145A', 'RED'),
            'Expected the overview to reflect the decrease at the item''s other location');
        Assert.AreEqual(19, Overview.GetNetworkTotalQuantity('ITM145A'),
            'Expected the network total to be the sum across both of this item''s locations only');
        Assert.AreEqual(0, Overview.GetLocationTotalQuantity('SENTINEL145', 'BLUE'),
            'Expected an unrelated item to report no quantity at a location it was never posted to');
    end;

    [Test]
    procedure NetworkOverviewTransferMovesQuantityAcrossLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
        Overview: Codeunit "CG X145 Network Overview";
        NetworkTotalBefore: Decimal;
        NetworkTotalAfter: Decimal;
    begin
        ClearAll();
        SeedBalance('ITM145B', 'BLUE', 40);
        SeedBalance('ITM145B', 'RED', 5);
        SeedLine('DOC145B', 10, "CG X139 Adjustment Type"::Transfer, 'ITM145B', 'BLUE', 'RED', 18);

        NetworkTotalBefore := Overview.GetNetworkTotalQuantity('ITM145B');

        Poster.PostAdjustments('DOC145B');

        NetworkTotalAfter := Overview.GetNetworkTotalQuantity('ITM145B');

        Assert.AreEqual(22, Overview.GetLocationTotalQuantity('ITM145B', 'BLUE'),
            'Expected the source location to show the reduced quantity once the network overview reflects the move');
        Assert.AreEqual(23, Overview.GetLocationTotalQuantity('ITM145B', 'RED'),
            'Expected the destination location to show the received quantity once the network overview reflects the move');
        Assert.AreEqual(NetworkTotalBefore, NetworkTotalAfter,
            'Expected the network total for the item to stay the same before and after the move, since it only relocates existing stock');
    end;

    [Test]
    procedure FormatLocationQuantityAppliesTheSharedDisplayRateWhenConfigured()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
        Overview: Codeunit "CG X145 Network Overview";
        Treasury: Codeunit "CG X128 Treasury Rate";
    begin
        ClearAll();
        ClearHomeGroupRate();
        SeedBalance('ITM145C', 'BLUE', 8);
        SeedLine('DOC145C', 10, "CG X139 Adjustment Type"::Increase, 'ITM145C', 'BLUE', '', 2);

        Poster.PostAdjustments('DOC145C');

        Assert.AreEqual('10', Overview.FormatLocationQuantity('ITM145C', 'BLUE', 'NODISP'),
            'Expected the raw quantity when no shared display setting is configured for the given code');

        Treasury.SetIntercompanyRate('DISP145', 2.5);

        Assert.AreEqual('25', Overview.FormatLocationQuantity('ITM145C', 'BLUE', 'DISP145'),
            'Expected the quantity scaled by the shared display setting once one is configured for the given code');

        ClearHomeGroupRate();
    end;
}
