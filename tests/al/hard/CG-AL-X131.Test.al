codeunit 89351 "CG-AL-X131 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured, SOAP runner), so every test that seeds rows clears the
    // table first. A second, unrelated batch is seeded with nonzero
    // sentinel values wherever isolation is under test, so "untouched" and
    // "wiped" stay distinguishable.

    local procedure MakeLine(var ImportLine: Record "CG X131 Import Line"; BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Item No." := ItemNo;
        ImportLine.Quantity := NewQuantity;
        ImportLine."Unit Cost" := NewUnitCost;
    end;

    local procedure InsertLine(BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    var
        ImportLine: Record "CG X131 Import Line";
    begin
        MakeLine(ImportLine, BatchCode, LineNo, ItemNo, NewQuantity, NewUnitCost);
        ImportLine.Insert();
    end;

    [Test]
    procedure CheckLineAcceptsAFullyValidLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A line satisfying every rule should report no problems');
    end;

    [Test]
    procedure CheckLineAcceptsAZeroUnitCost()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 0);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Unit Cost of exactly 0 is allowed - only a negative cost is a problem');
    end;

    [Test]
    procedure CheckLineAcceptsAQuantityJustAboveZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 0.01, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Quantity just above zero is allowed - only zero or below is a problem');
    end;

    [Test]
    procedure CheckLineReportsAMissingItemNo()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 10000, '', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A blank Item No. is the only problem on this line');
        Assert.AreEqual('Line 10000: Item No. is missing.', LineMessages.Get(1), 'Expected the missing-item message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsAZeroQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', 0, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A zero Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsANegativeQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', -3, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A negative Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsAUnitCostJustBelowZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 30000, 'ITEM-1', 5, -0.01);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A Unit Cost just below zero is the only problem on this line');
        Assert.AreEqual('Line 30000: Unit Cost cannot be negative.', LineMessages.Get(1), 'Expected the unit cost message with the line''s own number');
    end;

    [Test]
    procedure CheckLineReportsOnlyTheFirstRuleWhenAllThreeAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 40000, '', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line breaking every rule must still report exactly one problem - its first broken rule');
        Assert.AreEqual('Line 40000: Item No. is missing.', LineMessages.Get(1), 'Expected the FIRST rule in the order (Item No., then Quantity, then Unit Cost) to be the one reported');
    end;

    [Test]
    procedure CheckLineReportsTheQuantityRuleWhenItemIsValidButQuantityAndCostAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        MakeLine(ImportLine, 'ONE-OFF', 50000, 'ITEM-1', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line with a valid Item No. but two broken rules must still report exactly one problem');
        Assert.AreEqual('Line 50000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected Quantity - the earlier rule of the two remaining - to be the one reported, not Unit Cost');
    end;

    [Test]
    procedure CheckBatchReportsOneMessagePerProblemLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-A', 10000, 'ITEM-1', 5, 10);
        InsertLine('BATCH-A', 20000, 'ITEM-2', 0, 10);
        InsertLine('BATCH-A', 30000, '', 0, -5);
        InsertLine('BATCH-A', 40000, 'ITEM-4', 3, 8);

        Checker.CheckBatch('BATCH-A', Problems);

        Assert.AreEqual(2, Problems.Count(), 'Expected exactly one problem per problem line - two lines are broken, not more entries for the line breaking several rules');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(1), 'Expected the first problem to belong to line 20000, in line order');
        Assert.AreEqual('Line 30000: Item No. is missing.', Problems.Get(2), 'Expected the second problem to be line 30000''s FIRST broken rule, not one entry per rule it breaks');
    end;

    [Test]
    procedure CheckBatchIgnoresLinesOfOtherBatches()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-B1', 10000, '', 5, 10);
        InsertLine('BATCH-B2', 20000, '', 7, 20);

        Checker.CheckBatch('BATCH-B1', Problems);

        Assert.AreEqual(1, Problems.Count(), 'The other batch''s broken line must not leak into this batch''s result');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the reported problem to belong to the requested batch');

        ImportLine.Get('BATCH-B2', 20000);
        Assert.AreEqual('', ImportLine."Item No.", 'The other batch''s line must be left exactly as seeded');
        Assert.AreEqual(7, ImportLine.Quantity, 'The other batch''s Quantity must survive untouched');
        Assert.AreEqual(20, ImportLine."Unit Cost", 'The other batch''s Unit Cost must survive untouched');
    end;

    [Test]
    procedure CheckBatchReturnsAnEmptyListForACleanBatch()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-C', 10000, 'ITEM-1', 5, 10);
        InsertLine('BATCH-C', 20000, 'ITEM-2', 3, 0);

        Checker.CheckBatch('BATCH-C', Problems);

        Assert.AreEqual(0, Problems.Count(), 'A batch where every line passes every rule must report no problems');
    end;

    [Test]
    procedure CheckBatchReplacesEarlierListContents()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        InsertLine('BATCH-D', 10000, '', 5, 10);
        InsertLine('BATCH-D', 20000, 'ITEM-2', 0, 10);

        Checker.CheckBatch('BATCH-D', Problems);
        Checker.CheckBatch('BATCH-D', Problems);

        Assert.AreEqual(2, Problems.Count(), 'A second run must replace the first run''s findings, not add to them');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the first problem of the second run to still be line 10000');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(2), 'Expected the second problem of the second run to still be line 20000');
    end;
}
