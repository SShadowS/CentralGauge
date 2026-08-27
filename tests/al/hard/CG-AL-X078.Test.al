codeunit 88831 "CG-AL-X078 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the
    // performance register before seeding its own rows.

    local procedure SeedPerformance(EntryNo: Integer; AgreementNo: Code[20]; PlayName: Text[50]; Category: Code[20]; Audience: Integer)
    var
        Performance: Record "CG X078 Performance";
    begin
        Performance.Init();
        Performance."Entry No." := EntryNo;
        Performance."Agreement No." := AgreementNo;
        Performance."Play Name" := PlayName;
        Performance.Category := Category;
        Performance.Audience := Audience;
        Performance.Insert();
    end;

    local procedure VerifyLine(var StatementLine: Record "CG X078 Statement Line" temporary; LineNo: Integer; PlayName: Text[50]; Category: Code[20]; Audience: Integer; Amount: Decimal; Credits: Integer)
    begin
        Assert.IsTrue(StatementLine.Get(LineNo), StrSubstNo('Expected the statement to contain line %1', LineNo));
        Assert.AreEqual(PlayName, StatementLine."Play Name", StrSubstNo('Expected the play name copied onto line %1', LineNo));
        Assert.AreEqual(Category, StatementLine.Category, StrSubstNo('Expected the category copied onto line %1', LineNo));
        Assert.AreEqual(Audience, StatementLine.Audience, StrSubstNo('Expected the audience copied onto line %1', LineNo));
        Assert.AreEqual(Amount, StatementLine.Amount, StrSubstNo('Expected the fee for line %1 (%2, audience %3)', LineNo, Category, Audience));
        Assert.AreEqual(Credits, StatementLine.Credits, StrSubstNo('Expected the loyalty credits for line %1 (%2, audience %3)', LineNo, Category, Audience));
    end;

    [Test]
    procedure TragedyChargesFlatFeeAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(400.0, Statement.LineAmount('TRAGEDY', 30), 'Expected the flat tragedy base fee at exactly 30 attendees, the surcharge starts only above 30');
    end;

    [Test]
    procedure TragedyAddsSurchargeJustAboveThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(410.0, Statement.LineAmount('TRAGEDY', 31), 'Expected the tragedy base fee plus one surcharge step at 31 attendees');
    end;

    [Test]
    procedure ComedyEarnsNoBonusAtExactlyTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(360.0, Statement.LineAmount('COMEDY', 20), 'Expected the comedy fee with no bonus at exactly 20 attendees, the bonus starts only above 20');
    end;

    [Test]
    procedure ComedyAddsBonusJustAboveTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(468.0, Statement.LineAmount('COMEDY', 21), 'Expected the comedy fee with its bonus and one bonus step at 21 attendees');
    end;

    [Test]
    procedure NoCreditsAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(0, Statement.LineCredits('TRAGEDY', 30), 'Expected zero credits at exactly 30 attendees, credits start only above 30');
    end;

    [Test]
    procedure OneCreditAtThirtyOneAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('TRAGEDY', 31), 'Expected exactly one credit at 31 attendees');
    end;

    [Test]
    procedure ComedyAddsCreditPerFullGroupOfFiveAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(10, Statement.LineCredits('COMEDY', 34), 'Expected 4 threshold credits plus 6 group-of-five credits for a comedy audience of 34');
    end;

    [Test]
    procedure ComedyCreditsDropPartialGroupOfFive()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('COMEDY', 9), 'Expected exactly one group-of-five credit for a comedy audience of 9, the remaining four attendees earn nothing');
    end;

    [Test]
    procedure UnknownCategoryFailsLineAmount()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineAmount('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure UnknownCategoryFailsLineCredits()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineCredits('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure BuildStatementListsAgreementPerformancesInOrderWithCorrectTotals()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A single build with freshly declared totals produces the right lines and sums.
        Performance.DeleteAll();
        SeedPerformance(1701, 'TRYAL-RS17', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(1702, 'TRYAL-RS17', 'As You Like It', 'COMEDY', 35);
        SeedPerformance(1703, 'TRYAL-RS17', 'Othello', 'TRAGEDY', 15);
        SeedPerformance(1704, 'TRYAL-RS17X', 'The Tempest', 'COMEDY', 40);

        Statement.BuildStatement('TRYAL-RS17', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per performance of the agreement, performances of another agreement are excluded');
        VerifyLine(StatementLine, 1, 'Hamlet', 'TRAGEDY', 55, 650.0, 25);
        VerifyLine(StatementLine, 2, 'As You Like It', 'COMEDY', 35, 580.0, 12);
        VerifyLine(StatementLine, 3, 'Othello', 'TRAGEDY', 15, 400.0, 0);
        Assert.AreEqual(1630.0, TotalAmount, 'Expected TotalAmount to be the sum of the three line amounts');
        Assert.AreEqual(37, TotalCredits, 'Expected TotalCredits to be the sum of the three line credits');
    end;

    [Test]
    procedure BuildStatementDoesNotCarryOverThePriorAgreementsTotalsWhenReused()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] Building statements for two agreements back-to-back with the same output variables: the second agreement's totals must be its own, not layered onto the first's.
        Performance.DeleteAll();
        SeedPerformance(3001, 'TRYAL-A', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(3002, 'TRYAL-B', 'Othello', 'TRAGEDY', 15);

        Statement.BuildStatement('TRYAL-A', StatementLine, TotalAmount, TotalCredits);
        Assert.AreEqual(650.0, TotalAmount, 'Expected the first agreement''s own total');
        Assert.AreEqual(25, TotalCredits, 'Expected the first agreement''s own credits');

        Statement.BuildStatement('TRYAL-B', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected only the second agreement''s own line in the buffer');
        Assert.AreEqual(400.0, TotalAmount, 'Expected the second agreement''s TotalAmount to reflect only its own performance, not the first agreement''s total on top');
        Assert.AreEqual(0, TotalCredits, 'Expected the second agreement''s TotalCredits to reflect only its own performance, not the first agreement''s credits on top');
    end;

    [Test]
    procedure BuildStatementClearsPreSetTotalsAndStaleBufferLine()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A caller that pre-sets its totals (or passes in dirty output variables) still gets a clean recomputation.
        Performance.DeleteAll();
        SeedPerformance(1801, 'TRYAL-RS18', 'King Lear', 'TRAGEDY', 40);
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 123.45;
        TotalCredits := 77;

        Statement.BuildStatement('TRYAL-RS18', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the buffer to hold only the fresh statement, a line from before the build must be removed first');
        Assert.IsFalse(StatementLine.Get(999), 'Expected the stale line 999 from before the build to be gone');
        VerifyLine(StatementLine, 1, 'King Lear', 'TRAGEDY', 40, 500.0, 10);
        Assert.AreEqual(500.0, TotalAmount, 'Expected TotalAmount to be recomputed from scratch, not added onto the pre-set value');
        Assert.AreEqual(10, TotalCredits, 'Expected TotalCredits to be recomputed from scratch, not added onto the pre-set value');
    end;

    [Test]
    procedure BuildStatementYieldsZeroTotalsForAgreementWithNoPerformancesEvenWithDirtyInputs()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] An agreement with no performances yields an empty buffer and zero totals even when the outputs start dirty.
        Performance.DeleteAll();
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 999.99;
        TotalCredits := 99;

        Statement.BuildStatement('TRYAL-RS19', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(), 'Expected an empty statement for an agreement with no performances');
        Assert.AreEqual(0.0, TotalAmount, 'Expected TotalAmount to come back at zero for an agreement with no performances, whatever it held on entry');
        Assert.AreEqual(0, TotalCredits, 'Expected TotalCredits to come back at zero for an agreement with no performances, whatever it held on entry');
    end;

    [Test]
    procedure BuildStatementFailsWhenAPerformanceHasUnknownCategory()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        Performance.DeleteAll();
        SeedPerformance(2001, 'TRYAL-RS20', 'Hamlet', 'TRAGEDY', 30);
        SeedPerformance(2002, 'TRYAL-RS20', 'Henry V', 'HISTORY', 25);

        asserterror Statement.BuildStatement('TRYAL-RS20', StatementLine, TotalAmount, TotalCredits);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure RandomAgreementTotalsMatchIndependentComputation()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        Any: Codeunit Any;
        Category: Code[20];
        Audience: Integer;
        i: Integer;
        ExpectedAmount: Decimal;
        ExpectedCredits: Integer;
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A generated agreement totals exactly what the fee and credit rules say, computed independently of BuildStatement's own internals.
        Performance.DeleteAll();
        for i := 1 to 5 do begin
            if i mod 2 = 1 then
                Category := 'TRAGEDY'
            else
                Category := 'COMEDY';
            Audience := Any.IntegerInRange(1, 150);
            SeedPerformance(2100 + i, 'TRYAL-RS21', StrSubstNo('Play %1', i), Category, Audience);
            ExpectedAmount += IndependentAmount(Category, Audience);
            ExpectedCredits += IndependentCredits(Category, Audience);
        end;

        Statement.BuildStatement('TRYAL-RS21', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(5, StatementLine.Count(), 'Expected one statement line per generated performance');
        Assert.AreEqual(ExpectedAmount, TotalAmount, 'Expected TotalAmount to match the independently computed sum of the generated fees');
        Assert.AreEqual(ExpectedCredits, TotalCredits, 'Expected TotalCredits to match the independently computed sum of the generated credits');
    end;

    local procedure IndependentAmount(Category: Code[20]; Audience: Integer): Decimal
    begin
        if Category = 'TRAGEDY' then begin
            if Audience > 30 then
                exit(400.0 + 10 * (Audience - 30));
            exit(400.0);
        end;
        if Audience > 20 then
            exit(300.0 + 3 * Audience + 100 + 5 * (Audience - 20));
        exit(300.0 + 3 * Audience);
    end;

    local procedure IndependentCredits(Category: Code[20]; Audience: Integer): Integer
    var
        Credits: Integer;
    begin
        if Audience > 30 then
            Credits := Audience - 30;
        if Category = 'COMEDY' then
            Credits += Audience div 5;
        exit(Credits);
    end;

    [Test]
    procedure BuildStatementLeavesTheBufferHoldingOnlyTheStatementJustBuilt()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] The caller hands over a buffer that already holds a line
        // from earlier work AND is narrowed to a range that does not cover it.
        // Building a statement replaces the whole buffer, so the leftover must
        // be gone whatever part of it the caller happened to be reading.
        Performance.DeleteAll();
        SeedPerformance(1751, 'TRYAL-RS51', 'Macbeth', 'TRAGEDY', 30);

        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine."Play Name" := 'Left over from earlier work';
        StatementLine.Insert();
        StatementLine.SetRange("Line No.", 1, 100);

        Statement.BuildStatement('TRYAL-RS51', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the buffer to hold only the lines of the statement just built, whatever part of it the caller was reading beforehand');
        Assert.IsFalse(StatementLine.Get(999), 'The leftover line must not survive a rebuild just because it sat outside the caller''s filter');
    end;
}
