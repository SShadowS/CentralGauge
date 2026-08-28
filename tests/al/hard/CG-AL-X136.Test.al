codeunit 89356 "CG-AL-X136 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own records.

    local procedure ClearAllTerms()
    var
        Terms: Record "CG X136 Payment Terms";
    begin
        Terms.DeleteAll();
    end;

    local procedure SeedTerms(TermsCode: Code[10]; DueDateFormulaText: Text; DiscountDateFormulaText: Text)
    var
        Terms: Record "CG X136 Payment Terms";
        DueFormula: DateFormula;
        DiscountFormula: DateFormula;
    begin
        if DueDateFormulaText <> '' then
            Evaluate(DueFormula, DueDateFormulaText);
        if DiscountDateFormulaText <> '' then
            Evaluate(DiscountFormula, DiscountDateFormulaText);

        Terms.Init();
        Terms."Code" := TermsCode;
        Terms."Due Date Calculation" := DueFormula;
        Terms."Discount Date Calculation" := DiscountFormula;
        Terms.Insert();
    end;

    // ---- Shown examples (disclosed in the task description) ----

    [Test]
    procedure PaymentOnTheDiscountDateQualifies()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('NET8', '', '<8D>');

        Assert.IsTrue(
            Calculator.QualifiesForDiscount('NET8', DMY2Date(10, 6, 2026), DMY2Date(18, 6, 2026)),
            'Expected a payment on 18-06-2026 to qualify under NET8 (<8D> over 10-06-2026), got false');
    end;

    [Test]
    procedure PaymentTheDayAfterTheDiscountDateDoesNotQualify()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('NET8', '', '<8D>');

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('NET8', DMY2Date(10, 6, 2026), DMY2Date(19, 6, 2026)),
            'Expected a payment on 19-06-2026 to no longer qualify under NET8 (<8D> over 10-06-2026), got true');
    end;

    [Test]
    procedure TermOrderCM10QualifiesOnTheComputedDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('CM10', '', '<CM+10D>');

        Assert.IsTrue(
            Calculator.QualifiesForDiscount('CM10', DMY2Date(15, 2, 2024), DMY2Date(10, 3, 2024)),
            'Expected a payment on 10-03-2024 to qualify under CM10 (<CM+10D> over 15-02-2024), got false');
    end;

    [Test]
    procedure TermOrder10CMDoesNotQualifyOnTheSameDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
    begin
        ClearAllTerms();
        SeedTerms('10CM', '', '<10D+CM>');

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('10CM', DMY2Date(15, 2, 2024), DMY2Date(10, 3, 2024)),
            'Expected a payment on 10-03-2024 to not qualify under 10CM (<10D+CM> over 15-02-2024), got true');
    end;

    // ---- Hidden: the untouched due-date contract still holds (the starter passes this) ----

    [Test]
    procedure DueDateAppliesTheFormulaFromTheDocumentDate()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
        DueDate: Date;
    begin
        ClearAllTerms();
        SeedTerms('NET14', '<14D>', '');

        DueDate := Calculator.CalcDueDate('NET14', DMY2Date(6, 3, 2026));

        Assert.AreEqual(DMY2Date(20, 3, 2026), DueDate, 'Expected NET14 (<14D> over 06-03-2026) to fall due on 20-03-2026');
    end;

    // ---- Hidden: cross-entity isolation and mutation safety ----

    [Test]
    procedure EachTermsRecordIsEvaluatedIndependently()
    var
        Calculator: Codeunit "CG X136 Terms Calculator";
        GammaDocumentDate: Date;
        GammaDueBefore: Date;
        GammaDueAfter: Date;
        GammaQualifiesBefore: Boolean;
        GammaQualifiesAfter: Boolean;
        DocumentDate: Date;
        PaymentDate: Date;
    begin
        ClearAllTerms();
        SeedTerms('ALPHA', '', '<5D>');
        SeedTerms('BETA', '', '<20D>');
        SeedTerms('GAMMA', '<30D>', '<3D>');

        GammaDocumentDate := DMY2Date(1, 1, 2026);
        GammaDueBefore := Calculator.CalcDueDate('GAMMA', GammaDocumentDate);
        GammaQualifiesBefore := Calculator.QualifiesForDiscount('GAMMA', GammaDocumentDate, DMY2Date(4, 1, 2026));

        DocumentDate := DMY2Date(1, 6, 2026);
        PaymentDate := DMY2Date(15, 6, 2026);

        Assert.IsFalse(
            Calculator.QualifiesForDiscount('ALPHA', DocumentDate, PaymentDate),
            'Expected ALPHA (<5D> over 01-06-2026) to no longer qualify a payment on 15-06-2026');
        Assert.IsTrue(
            Calculator.QualifiesForDiscount('BETA', DocumentDate, PaymentDate),
            'Expected BETA (<20D> over 01-06-2026) to still qualify a payment on 15-06-2026');

        GammaDueAfter := Calculator.CalcDueDate('GAMMA', GammaDocumentDate);
        GammaQualifiesAfter := Calculator.QualifiesForDiscount('GAMMA', GammaDocumentDate, DMY2Date(4, 1, 2026));

        Assert.AreEqual(GammaDueBefore, GammaDueAfter, 'Expected GAMMA''s own due-date formula to be unaffected by evaluating ALPHA and BETA');
        Assert.AreEqual(GammaQualifiesBefore, GammaQualifiesAfter, 'Expected GAMMA''s own discount formula to be unaffected by evaluating ALPHA and BETA');
        Assert.AreEqual(DMY2Date(31, 1, 2026), GammaDueAfter, 'Expected GAMMA (<30D> over 01-01-2026) to fall due on 31-01-2026');
        Assert.IsTrue(GammaQualifiesAfter, 'Expected GAMMA (<3D> over 01-01-2026) to qualify a payment on 04-01-2026');
    end;

    // ---- Hidden: deterministic sweep across many (formula, document date, payment date) triples ----
    // Each formula group is graded on-the-computed-date and one day after it; the on-date rows
    // are exactly where the two candidate comparisons in QualifiesForDiscount disagree.

    [Test]
    procedure QualifiesForDiscountMatchesTheComputedDateAcrossManyFormulasAndDates()
    var
        Terms: Record "CG X136 Payment Terms";
        Calculator: Codeunit "CG X136 Terms Calculator";
        Formulas: List of [Text];
        DocDates: List of [Date];
        PayDates: List of [Date];
        Expected: List of [Boolean];
        Contexts: List of [Text];
        DiscountFormula: DateFormula;
        Idx: Integer;
        Actual: Boolean;
    begin
        ClearAllTerms();
        Terms.Init();
        Terms."Code" := 'SWEEP';
        Terms.Insert();

        // Plain day offset
        Formulas.Add('<5D>');
        DocDates.Add(DMY2Date(1, 4, 2026));
        PayDates.Add(DMY2Date(6, 4, 2026));
        Expected.Add(true);
        Contexts.Add('<5D> from 01-04-2026, payment on the computed date');

        Formulas.Add('<5D>');
        DocDates.Add(DMY2Date(1, 4, 2026));
        PayDates.Add(DMY2Date(7, 4, 2026));
        Expected.Add(false);
        Contexts.Add('<5D> from 01-04-2026, payment one day after the computed date');

        // Plain week offset
        Formulas.Add('<2W>');
        DocDates.Add(DMY2Date(3, 1, 2026));
        PayDates.Add(DMY2Date(17, 1, 2026));
        Expected.Add(true);
        Contexts.Add('<2W> from 03-01-2026, payment on the computed date');

        Formulas.Add('<2W>');
        DocDates.Add(DMY2Date(3, 1, 2026));
        PayDates.Add(DMY2Date(18, 1, 2026));
        Expected.Add(false);
        Contexts.Add('<2W> from 03-01-2026, payment one day after the computed date');

        // Month-end jump, common year
        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(5, 1, 2026));
        PayDates.Add(DMY2Date(31, 1, 2026));
        Expected.Add(true);
        Contexts.Add('<CM> from 05-01-2026, payment on the computed date');

        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(5, 1, 2026));
        PayDates.Add(DMY2Date(1, 2, 2026));
        Expected.Add(false);
        Contexts.Add('<CM> from 05-01-2026, payment one day after the computed date');

        // Month-end jump, leap February
        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(10, 2, 2024));
        PayDates.Add(DMY2Date(29, 2, 2024));
        Expected.Add(true);
        Contexts.Add('<CM> from 10-02-2024, payment on the computed date (leap February)');

        Formulas.Add('<CM>');
        DocDates.Add(DMY2Date(10, 2, 2024));
        PayDates.Add(DMY2Date(1, 3, 2024));
        Expected.Add(false);
        Contexts.Add('<CM> from 10-02-2024, payment one day after the computed date (leap February)');

        // Month step clamping into a common-year February
        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2026));
        PayDates.Add(DMY2Date(28, 2, 2026));
        Expected.Add(true);
        Contexts.Add('<1M> from 31-01-2026, payment on the clamped computed date');

        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2026));
        PayDates.Add(DMY2Date(1, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<1M> from 31-01-2026, payment one day after the clamped computed date');

        // Month step clamping into a leap-year February
        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2024));
        PayDates.Add(DMY2Date(29, 2, 2024));
        Expected.Add(true);
        Contexts.Add('<1M> from 31-01-2024, payment on the clamped computed date (leap February)');

        Formulas.Add('<1M>');
        DocDates.Add(DMY2Date(31, 1, 2024));
        PayDates.Add(DMY2Date(1, 3, 2024));
        Expected.Add(false);
        Contexts.Add('<1M> from 31-01-2024, payment one day after the clamped computed date (leap February)');

        // Year step off a leap day, clamping into a common year
        Formulas.Add('<1Y>');
        DocDates.Add(DMY2Date(29, 2, 2024));
        PayDates.Add(DMY2Date(28, 2, 2025));
        Expected.Add(true);
        Contexts.Add('<1Y> from the leap day 29-02-2024, payment on the clamped computed date');

        Formulas.Add('<1Y>');
        DocDates.Add(DMY2Date(29, 2, 2024));
        PayDates.Add(DMY2Date(1, 3, 2025));
        Expected.Add(false);
        Contexts.Add('<1Y> from the leap day 29-02-2024, payment one day after the clamped computed date');

        // Three chained terms, one order
        Formulas.Add('<CM+1M-10D>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(20, 5, 2026));
        Expected.Add(true);
        Contexts.Add('<CM+1M-10D> from 18-04-2026, payment on the computed date');

        Formulas.Add('<CM+1M-10D>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(21, 5, 2026));
        Expected.Add(false);
        Contexts.Add('<CM+1M-10D> from 18-04-2026, payment one day after the computed date');

        // Same three terms, different order - lands on a different date
        Formulas.Add('<1M-10D+CM>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(31, 5, 2026));
        Expected.Add(true);
        Contexts.Add('<1M-10D+CM> from 18-04-2026, payment on the computed date');

        Formulas.Add('<1M-10D+CM>');
        DocDates.Add(DMY2Date(18, 4, 2026));
        PayDates.Add(DMY2Date(1, 6, 2026));
        Expected.Add(false);
        Contexts.Add('<1M-10D+CM> from 18-04-2026, payment one day after the computed date');

        // Weekday jump, forward, from a date not already on that weekday
        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(4, 3, 2026));
        PayDates.Add(DMY2Date(6, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<WD5> from Wednesday 04-03-2026, payment on the computed date');

        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(4, 3, 2026));
        PayDates.Add(DMY2Date(7, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<WD5> from Wednesday 04-03-2026, payment one day after the computed date');

        // Weekday jump, forward, from a date already on that weekday (moves a full week)
        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(6, 3, 2026));
        PayDates.Add(DMY2Date(13, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<WD5> from Friday 06-03-2026, payment on the computed date');

        Formulas.Add('<WD5>');
        DocDates.Add(DMY2Date(6, 3, 2026));
        PayDates.Add(DMY2Date(14, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<WD5> from Friday 06-03-2026, payment one day after the computed date');

        // Weekday jump, backward
        Formulas.Add('<-WD2>');
        DocDates.Add(DMY2Date(10, 3, 2026));
        PayDates.Add(DMY2Date(3, 3, 2026));
        Expected.Add(true);
        Contexts.Add('<-WD2> from Tuesday 10-03-2026, payment on the computed date');

        Formulas.Add('<-WD2>');
        DocDates.Add(DMY2Date(10, 3, 2026));
        PayDates.Add(DMY2Date(4, 3, 2026));
        Expected.Add(false);
        Contexts.Add('<-WD2> from Tuesday 10-03-2026, payment one day after the computed date');

        for Idx := 1 to Formulas.Count() do begin
            Terms.Get('SWEEP');
            Evaluate(DiscountFormula, Formulas.Get(Idx));
            Terms."Discount Date Calculation" := DiscountFormula;
            Terms.Modify();

            Actual := Calculator.QualifiesForDiscount('SWEEP', DocDates.Get(Idx), PayDates.Get(Idx));

            Assert.AreEqual(Expected.Get(Idx), Actual, StrSubstNo('%1: expected qualifies=%2, got %3', Contexts.Get(Idx), Format(Expected.Get(Idx)), Format(Actual)));
        end;
    end;
}
