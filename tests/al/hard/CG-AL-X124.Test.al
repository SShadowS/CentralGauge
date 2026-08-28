codeunit 89318 "CG-AL-X124 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearAll()
    var
        Header: Record "CG X124 Shipment Header";
        Line: Record "CG X124 Shipment Line";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
    end;

    local procedure SeedHeader(ShipmentNo: Code[20]; CustomerName: Text[100]; RouteCode: Code[10])
    var
        Header: Record "CG X124 Shipment Header";
        Ok: Boolean;
    begin
        Header.Init();
        Header."No." := ShipmentNo;
        Header."Customer Name" := CustomerName;
        Header."Route Code" := RouteCode;
        // Nonzero sentinels: an untouched shipment must keep these exactly.
        Header."Total Weight" := -1;
        Header."Line Count" := -1;
        Ok := Header.Insert();
    end;

    local procedure SeedLine(ShipmentNo: Code[20]; LineNo: Integer; ItemCode: Code[20]; LineWeight: Decimal)
    var
        Line: Record "CG X124 Shipment Line";
        Ok: Boolean;
    begin
        Line.Init();
        Line."Shipment No." := ShipmentNo;
        Line."Line No." := LineNo;
        Line."Item Code" := ItemCode;
        Line.Weight := LineWeight;
        Ok := Line.Insert();
    end;

    [Test]
    procedure TotalsAddUpEveryLineOnTheShipment()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] The stored totals match the lines that are actually there
        ClearAll();
        SeedHeader('SHP-01', 'Northwind Traders', 'ROUTE-A');
        SeedLine('SHP-01', 10000, 'ITEM-A', 12.5);
        SeedLine('SHP-01', 20000, 'ITEM-B', 7.25);
        SeedLine('SHP-01', 30000, 'ITEM-C', 0.25);

        Totals.Recalculate('SHP-01');

        Assert.AreEqual(20.0, Totals.TotalWeightOf('SHP-01'),
            'Expected the stored weight to add up the weights on the lines');
        Assert.AreEqual(3, Totals.LineCountOf('SHP-01'),
            'Expected the stored line count to match how many lines there are');
    end;

    [Test]
    procedure LinesOnOtherShipmentsNeverCountTowardsThisOne()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] Two shipments are totalled independently
        ClearAll();
        SeedHeader('SHP-02A', 'Adatum', 'ROUTE-A');
        SeedHeader('SHP-02B', 'Fabrikam', 'ROUTE-B');
        SeedLine('SHP-02A', 10000, 'ITEM-A', 10);
        SeedLine('SHP-02A', 20000, 'ITEM-B', 5);
        SeedLine('SHP-02B', 10000, 'ITEM-C', 100);

        Totals.Recalculate('SHP-02A');

        Assert.AreEqual(15.0, Totals.TotalWeightOf('SHP-02A'),
            'Expected the stored weight to cover only this shipment');
        Assert.AreEqual(2, Totals.LineCountOf('SHP-02A'),
            'Expected the stored line count to cover only this shipment');
        Assert.AreEqual(-1.0, Totals.TotalWeightOf('SHP-02B'),
            'Expected an untouched shipment to keep the weight it already had');
        Assert.AreEqual(-1, Totals.LineCountOf('SHP-02B'),
            'Expected an untouched shipment to keep the line count it already had');
    end;

    [Test]
    procedure AShipmentWithNoLinesTotalsToZero()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] Recalculating an empty shipment clears its stored totals
        ClearAll();
        SeedHeader('SHP-03', 'Contoso', 'ROUTE-A');

        Totals.Recalculate('SHP-03');

        Assert.AreEqual(0.0, Totals.TotalWeightOf('SHP-03'),
            'Expected a shipment with no lines to store a weight of zero');
        Assert.AreEqual(0, Totals.LineCountOf('SHP-03'),
            'Expected a shipment with no lines to store a line count of zero');
    end;

    [Test]
    procedure RecalculatingTwiceLeavesTheSameTotals()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
        FirstWeight: Decimal;
        FirstCount: Integer;
    begin
        // [SCENARIO] Recalculation does not accumulate on top of itself
        ClearAll();
        SeedHeader('SHP-04', 'Adatum', 'ROUTE-A');
        SeedLine('SHP-04', 10000, 'ITEM-A', 4.5);
        SeedLine('SHP-04', 20000, 'ITEM-B', 5.5);

        Totals.Recalculate('SHP-04');
        FirstWeight := Totals.TotalWeightOf('SHP-04');
        FirstCount := Totals.LineCountOf('SHP-04');

        Totals.Recalculate('SHP-04');

        Assert.AreEqual(FirstWeight, Totals.TotalWeightOf('SHP-04'),
            'Expected recalculating an unchanged shipment to leave the stored weight alone');
        Assert.AreEqual(FirstCount, Totals.LineCountOf('SHP-04'),
            'Expected recalculating an unchanged shipment to leave the stored line count alone');
    end;

    [Test]
    procedure TotalsFollowLinesThatWereRemoved()
    var
        Line: Record "CG X124 Shipment Line";
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] Removing a line and recalculating lowers the stored totals
        ClearAll();
        SeedHeader('SHP-05', 'Fabrikam', 'ROUTE-B');
        SeedLine('SHP-05', 10000, 'ITEM-A', 30);
        SeedLine('SHP-05', 20000, 'ITEM-B', 12);
        Totals.Recalculate('SHP-05');

        Line.Get('SHP-05', 20000);
        Line.Delete();
        Totals.Recalculate('SHP-05');

        Assert.AreEqual(30.0, Totals.TotalWeightOf('SHP-05'),
            'Expected the stored weight to drop to what the remaining lines add up to');
        Assert.AreEqual(1, Totals.LineCountOf('SHP-05'),
            'Expected the stored line count to drop to how many lines remain');
    end;

    [Test]
    procedure TheShipmentsOwnDetailsAreNotDisturbed()
    var
        Header: Record "CG X124 Shipment Header";
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] Recalculating totals changes nothing else on the shipment
        ClearAll();
        SeedHeader('SHP-06', 'Northwind Traders', 'ROUTE-C');
        SeedLine('SHP-06', 10000, 'ITEM-A', 8);

        Totals.Recalculate('SHP-06');

        Header.Get('SHP-06');
        // Read straight off the table, not through the accessors: the totals
        // are contracted to be STORED on the shipment, and a rewrite that
        // computes them on demand must not pass.
        Assert.AreEqual(8.0, Header."Total Weight",
            'Expected the shipment to carry the weight its lines add up to');
        Assert.AreEqual(1, Header."Line Count",
            'Expected the shipment to carry how many lines it has');
        Assert.AreEqual('Northwind Traders', Header."Customer Name",
            'Expected the customer on the shipment to be left exactly as it was');
        Assert.AreEqual('ROUTE-C', Header."Route Code",
            'Expected the route on the shipment to be left exactly as it was');
    end;

    [Test]
    procedure RecalculatingAnUnknownShipmentFails()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] There is no such shipment to recalculate
        ClearAll();

        asserterror Totals.Recalculate('NOPE');

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure RecalculatingCostsTheSameWhateverTheLineCount()
    var
        BigHeader: Record "CG X124 Shipment Header";
        Line: Record "CG X124 Shipment Line";
        Totals: Codeunit "CG X124 Shipment Totals";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        LineCount: Integer;
        SeededLines: Integer;
        i: Integer;
        ExpectedWeight: Decimal;
        Any: Codeunit Any;
    begin
        // [SCENARIO] A shipment with many lines is recalculated as cheaply as a small one
        ClearAll();

        // Warm-up on a DIFFERENT shipment, cleared before the graded data is
        // seeded, so nothing the measured call needs was resolved beforehand.
        SeedHeader('SHP-WARM', 'Warmup', 'ROUTE-A');
        SeedLine('SHP-WARM', 10000, 'ITEM-A', 1);
        Totals.Recalculate('SHP-WARM');
        ClearAll();

        Any.SetSeed(124);
        LineCount := Any.IntegerInRange(180, 220);
        SeedHeader('SHP-BIG', 'Adatum', 'ROUTE-A');
        for i := 1 to LineCount do begin
            SeedLine('SHP-BIG', i * 10000, 'ITEM-A', 2 + (i mod 5) * 0.25);
            ExpectedWeight := ExpectedWeight + 2 + (i mod 5) * 0.25;
        end;

        // Force the buffered inserts to flush BEFORE the measured window. Left
        // to itself the flush lands inside it, at the first read of the line
        // table, and its cost scales with the number of rows seeded - which is
        // exactly the line-count dependence this budget exists to exclude.
        SeededLines := Line.Count();

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        Totals.Recalculate('SHP-BIG');
        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        // Correctness inside the measured window, so a cheap-but-wrong
        // rewrite cannot pass on cost alone.
        Assert.AreEqual(ExpectedWeight, Totals.TotalWeightOf('SHP-BIG'),
            'Expected the stored weight to add up every line even on a large shipment');
        Assert.AreEqual(LineCount, Totals.LineCountOf('SHP-BIG'),
            'Expected the stored line count to match every line even on a large shipment');

        Assert.IsTrue(StmtDelta <= 20,
            StrSubstNo('Recalculating must not get more expensive as a shipment gains lines: allowed %1, actual %2 for %3 lines', 20, StmtDelta, LineCount));

        // Outside the measured window, so these reads cost the task nothing:
        // the totals must be STORED, not computed when someone asks.
        BigHeader.Get('SHP-BIG');
        Assert.AreEqual(ExpectedWeight, BigHeader."Total Weight",
            'Expected the shipment to carry the weight its lines add up to, even on a large shipment');
        Assert.AreEqual(LineCount, BigHeader."Line Count",
            'Expected the shipment to carry how many lines it has, even on a large shipment');
    end;

    [Test]
    procedure ReadingTheWeightOfAnUnknownShipmentFails()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] There is no such shipment to read a weight from
        ClearAll();

        asserterror Totals.TotalWeightOf('NOPE');

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure ReadingTheLineCountOfAnUnknownShipmentFails()
    var
        Totals: Codeunit "CG X124 Shipment Totals";
    begin
        // [SCENARIO] There is no such shipment to read a line count from
        ClearAll();

        asserterror Totals.LineCountOf('NOPE');

        Assert.ExpectedError('NOPE');
    end;
}
