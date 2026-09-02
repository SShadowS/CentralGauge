codeunit 89518 "CG-AL-X296 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears the table
        // before seeding its own rows.
        // DETERMINISM NOTE (read before re-probing or editing this oracle):
        // The starter's defect (codeunit "CG X072 Loyalty Rule VIP" assigns its
        // shared `var Eligible` parameter unconditionally instead of only
        // strengthening it) only produces an observable failure here if BC
        // dispatches "CG X072 Loyalty Rule Spend"'s subscriber BEFORE
        // "CG X072 Loyalty Rule VIP"'s on the container running this suite.
        // That dispatch order is real platform behavior BC does not guarantee.
        // Algebraically, under the flipped order (VIP fires first) an UNFIXED
        // candidate produces output IDENTICAL to the fix on every input this
        // suite exercises and passes all 7 tests - a false PASS, never a false
        // FAIL: "correct/" is order-independent by construction (both fixed
        // subscribers only ever set Eligible := true, which commutes regardless
        // of firing order), so its pass is never at risk here - only a
        // starter/candidate's fail is. Re-probe trigger fingerprint: an
        // all-green CG-AL-X072 column where failing/non-solving candidates diff
        // as no-ops against tasks/starter/CG-AL-X072/ signals dispatch order
        // flipped on that container, not that the trap stopped working.
        // Accepted residual, not caught by any test here: a buggy candidate
        // that renames or renumbers the VIP codeunit can incidentally change
        // its own subscriber-dispatch position and self-neutralize the defect
        // it was supposed to reproduce.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        //
        // The two dedicated date tests below, and the date sweep further
        // down, assume the container's session locale renders a bare
        // Format(Date) month-first with a 2-digit year (measured US on the
        // bench containers, decisions entry 16). On a locale that already
        // renders dates year-first, an unfixed Format(Date) call could
        // coincidentally produce the same string as the fixed one and those
        // tests would pass without the fix.
        // The default test isolation persists writes between test methods, so
        // every test clears its own tables before seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.

    // ==========================================================
    // X072 - donor CG-AL-X072
    // ==========================================================

    local procedure X072_Seed(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate.Insert();
    end;

    local procedure X072_SeedApproved(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate."Priority Support Approved" := true;
        Candidate.Insert();
    end;

    local procedure X072_ApprovedOf(No: Code[20]): Boolean
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Get(No);
        exit(Candidate."Priority Support Approved");
    end;

    [Test]
    procedure X072_QualifyingSpendAloneIsApprovedAlongsideANonQualifyingPeer()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C001', 'Northwind Traders', 6000, false);
        X072_Seed('C002', 'Contoso Ltd', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C001'), 'A candidate whose spend crosses the threshold must be approved even without the VIP override');
        Assert.IsFalse(X072_ApprovedOf('C002'), 'A candidate below the threshold and without the VIP override must stay unapproved');

        Candidate.Get('C001');
        Assert.AreEqual('Northwind Traders', Candidate."Customer Name", 'Evaluating a candidate must not change its recorded name');
        Assert.AreEqual(6000, Candidate."Lifetime Spend", 'Evaluating a candidate must not change its recorded spend');
    end;

    [Test]
    procedure X072_VipOverrideAloneIsApprovedBelowTheThreshold()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C010', 'Fabrikam Inc', 100, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C010'), 'A candidate with the VIP override on must be approved even below the spend threshold');
    end;

    [Test]
    procedure X072_NeitherConditionStaysUnapproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C020', 'Relecloud', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsFalse(X072_ApprovedOf('C020'), 'A candidate meeting neither condition must stay unapproved');
    end;

    [Test]
    procedure X072_BothConditionsTogetherAreApproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C030', 'Adatum Corp', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C030'), 'A candidate meeting both conditions must be approved');
    end;

    [Test]
    procedure X072_SpendThresholdBoundaryIsInclusive()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C040', 'Tailspin Toys', 5000, false);
        X072_Seed('C041', 'Wingtip Toys', 4999.99, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C040'), 'A candidate whose spend exactly reaches the threshold must be approved');
        Assert.IsFalse(X072_ApprovedOf('C041'), 'A candidate one cent short of the threshold must stay unapproved');
    end;

    [Test]
    procedure X072_AlreadyDecidedCandidatesAreLeftAlone()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_SeedApproved('C050', 'Trey Research', 100, false);
        X072_Seed('C051', 'Litware Inc', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C050'), 'A candidate already marked approved must stay approved without being reconsidered');
        Assert.IsTrue(X072_ApprovedOf('C051'), 'A pending candidate meeting both conditions must still be approved');
    end;

    [Test]
    procedure X072_SingleCandidateEvaluationMatchesBatchEvaluation()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C060', 'Proseware Inc', 5500, false);
        Candidate.Get('C060');

        Gatekeeper.EvaluateCandidate(Candidate);

        Assert.IsTrue(Candidate."Priority Support Approved", 'Evaluating a single candidate directly must approve one whose spend crosses the threshold');
        Assert.IsTrue(X072_ApprovedOf('C060'), 'The verdict from evaluating a single candidate must be persisted');
    end;

    // ==========================================================
    // X079 - donor CG-AL-X079
    // ==========================================================

    local procedure X079_ClearAllData()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure X079_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X079 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := DocumentNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Charge Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure X079_SeedLine(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine.Insert();
    end;

    local procedure X079_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine."Allocated Amount" := SentinelAmount;
        ChargeLine.Insert();
    end;

    // Re-reads the header and all of its lines from the database and checks
    // every guarantee an allocation must satisfy: the recorded amounts sum
    // to exactly the header total, every amount is a whole number of cents,
    // and every line stays within a cent of its exact proportional share -
    // so neither a naive independent rounding nor a fix that dumps the
    // whole correction onto a single line can pass.
    local procedure X079_VerifyAllocationBalances(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
        WeightSum: Decimal;
        SumOfAmounts: Decimal;
        ExactShare: Decimal;
    begin
        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                WeightSum += ChargeLine.Weight;
            until ChargeLine.Next() = 0;

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                SumOfAmounts += ChargeLine."Allocated Amount";
            until ChargeLine.Next() = 0;

        Assert.AreEqual(
          TotalAmount, SumOfAmounts,
          StrSubstNo('Expected the allocated amounts on charge %1 to sum to exactly its total %2, not a cent more or less', DocumentNo, TotalAmount));

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                Assert.AreEqual(
                  Round(ChargeLine."Allocated Amount", 0.01), ChargeLine."Allocated Amount",
                  StrSubstNo('Expected the amount on line %1 of charge %2 to be a whole number of cents', ChargeLine."Line No.", DocumentNo));
                ExactShare := TotalAmount * ChargeLine.Weight / WeightSum;
                Assert.IsTrue(
                  Abs(ChargeLine."Allocated Amount" - ExactShare) < 0.01,
                  StrSubstNo(
                    'Expected line %1 of charge %2 to stay within a cent of its fair share %3, got %4',
                    ChargeLine."Line No.", DocumentNo, ExactShare, ChargeLine."Allocated Amount"));
            until ChargeLine.Next() = 0;
    end;

    [Test]
    procedure X079_SingleLineChargeGetsTheEntireTotal()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('SL01', 123.45);
        X079_SeedLine('SL01', 1, 7.5);

        Allocator.AllocateCharge('SL01');

        ChargeLine.Get('SL01', 1);
        Assert.AreEqual(123.45, ChargeLine."Allocated Amount", 'Expected a charge with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X079_ThreeEqualWeightLinesSumExactlyToTheTotal()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('TW01', 100.00);
        X079_SeedLine('TW01', 1, 1);
        X079_SeedLine('TW01', 2, 1);
        X079_SeedLine('TW01', 3, 1);

        // A second charge, seeded with its own nonzero sentinel amounts and
        // left alone - proves allocating one charge does not disturb
        // another charge's recorded amounts or Allocated flag.
        X079_SeedHeader('TW02', 250.00);
        X079_SeedLineWithSentinel('TW02', 1, 1, 111.11);
        X079_SeedLineWithSentinel('TW02', 2, 1, 222.22);

        Allocator.AllocateCharge('TW01');

        X079_VerifyAllocationBalances('TW01', 100.00);
        Assert.AreEqual(
          100.00, Allocator.GetAllocatedTotal('TW01'),
          'Expected the reconciliation total for the charge to equal its header total after allocating');

        ChargeHeader.Get('TW02');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge that was not allocated to stay unallocated');
        ChargeLine.Get('TW02', 1);
        Assert.AreEqual(
          111.11, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
        ChargeLine.Get('TW02', 2);
        Assert.AreEqual(
          222.22, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
    end;

    [Test]
    procedure X079_SixEqualWeightLinesWithHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        i: Integer;
    begin
        // Every line's exact share (0.99 / 6 = 0.165) ends in half a cent,
        // so independent per-line rounding drifts by three cents in total -
        // exactly the pattern finance flagged.
        X079_ClearAllData();
        X079_SeedHeader('HC01', 0.99);
        for i := 1 to 6 do
            X079_SeedLine('HC01', i, 1);

        Allocator.AllocateCharge('HC01');

        X079_VerifyAllocationBalances('HC01', 0.99);
    end;

    [Test]
    procedure X079_UnequalFinelyWeightedLinesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Weights carried to five decimal places, none of them a round or
        // repeating fraction - a fix that only special-cases equal-weight
        // splits or exact half-cent shares still has to get this right.
        X079_ClearAllData();
        X079_SeedHeader('FP01', 143.99);
        X079_SeedLine('FP01', 1, 5.39998);
        X079_SeedLine('FP01', 2, 16.05634);
        X079_SeedLine('FP01', 3, 11.86395);

        Allocator.AllocateCharge('FP01');

        X079_VerifyAllocationBalances('FP01', 143.99);
    end;

    [Test]
    procedure X079_UnequalWeightsWithTwoHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Two of the three exact shares (40.005 and 39.995) sit exactly on
        // a half-cent boundary in opposite directions; the strict per-line
        // bound in VerifyAllocationBalances means the correction cannot be
        // parked entirely on any single line here without that line's
        // amount landing a full cent from its own whole-cent fair share.
        X079_ClearAllData();
        X079_SeedHeader('HB01', 100.00);
        X079_SeedLine('HB01', 1, 20.000);
        X079_SeedLine('HB01', 2, 40.005);
        X079_SeedLine('HB01', 3, 39.995);

        Allocator.AllocateCharge('HB01');

        X079_VerifyAllocationBalances('HB01', 100.00);
    end;

    [Test]
    procedure X079_TenLinesWithFinelyWeightedSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('FP10', 1000.00);
        X079_SeedLine('FP10', 1, 32.15163);
        X079_SeedLine('FP10', 2, 1.73803);
        X079_SeedLine('FP10', 3, 14.11395);
        X079_SeedLine('FP10', 4, 11.54893);
        X079_SeedLine('FP10', 5, 36.95533);
        X079_SeedLine('FP10', 6, 33.99662);
        X079_SeedLine('FP10', 7, 44.66289);
        X079_SeedLine('FP10', 8, 4.80347);
        X079_SeedLine('FP10', 9, 21.38513);
        X079_SeedLine('FP10', 10, 1.97496);

        Allocator.AllocateCharge('FP10');

        X079_VerifyAllocationBalances('FP10', 1000.00);
    end;

    [Test]
    procedure X079_ZeroWeightLineReceivesExactlyZero()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('ZW02', 99.99);
        X079_SeedLine('ZW02', 1, 5);
        X079_SeedLine('ZW02', 2, 0);
        X079_SeedLine('ZW02', 3, 3);

        Allocator.AllocateCharge('ZW02');

        ChargeLine.Get('ZW02', 2);
        Assert.AreEqual(
          0.0, ChargeLine."Allocated Amount",
          'Expected a line with no weight to be allocated exactly zero, even though other lines on the same charge carry a nonzero total');
        X079_VerifyAllocationBalances('ZW02', 99.99);
    end;

    [Test]
    procedure X079_NegativeTotalCreditMemoSumsExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('CM01', -100.01);
        X079_SeedLine('CM01', 1, 2);
        X079_SeedLine('CM01', 2, 1);

        Allocator.AllocateCharge('CM01');

        X079_VerifyAllocationBalances('CM01', -100.01);
    end;

    [Test]
    procedure X079_SuccessfulAllocationMarksTheChargeAllocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('MK01', 40.00);
        X079_SeedLine('MK01', 1, 1);
        X079_SeedLine('MK01', 2, 1);

        Allocator.AllocateCharge('MK01');

        ChargeHeader.Get('MK01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X079_AChargeWithNoWeightOnAnyLineIsLeftUnallocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('ZW01', 50.00);
        X079_SeedLineWithSentinel('ZW01', 1, 0, 555.55);
        X079_SeedLineWithSentinel('ZW01', 2, 0, 444.44);

        Allocator.AllocateCharge('ZW01');

        ChargeHeader.Get('ZW01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any line to be left unallocated');

        ChargeLine.Get('ZW01', 1);
        Assert.AreEqual(
          555.55, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
        ChargeLine.Get('ZW01', 2);
        Assert.AreEqual(
          444.44, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
    end;

    [Test]
    procedure X079_RandomChargeKeepsEveryLineWithinItsFairShare()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        Any: Codeunit Any;
        TotalAmount: Decimal;
        i: Integer;
    begin
        X079_ClearAllData();
        Any.SetSeed(79);
        TotalAmount := Any.IntegerInRange(10000, 999999) / 100;
        X079_SeedHeader('RND01', TotalAmount);
        for i := 1 to 9 do
            X079_SeedLine('RND01', i, Any.DecimalInRange(1, 500, 2));

        Allocator.AllocateCharge('RND01');

        X079_VerifyAllocationBalances('RND01', TotalAmount);
    end;

    // ==========================================================
    // X117 - donor CG-AL-X117
    // ==========================================================

    local procedure X117_Cleanup()
    var
        Order: Record "CG X117 Sales Order";
        OrderLine: Record "CG X117 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure X117_CreateOrder(No: Code[20]; CustomerNo: Code[20]; CustomerName: Text[100]; OrderDate: Date)
    var
        Order: Record "CG X117 Sales Order";
    begin
        Order.Init();
        Order."No." := No;
        Order."Customer No." := CustomerNo;
        Order."Customer Name" := CustomerName;
        Order."Order Date" := OrderDate;
        Order.Insert();
    end;

    local procedure X117_AddLine(DocumentNo: Code[20]; LineNo: Integer; No: Code[20]; LineDescription: Text[100]; Quantity: Decimal; UnitPrice: Decimal)
    var
        OrderLine: Record "CG X117 Order Line";
    begin
        OrderLine.Init();
        OrderLine."Document No." := DocumentNo;
        OrderLine."Line No." := LineNo;
        OrderLine."No." := No;
        OrderLine.Description := LineDescription;
        OrderLine.Quantity := Quantity;
        OrderLine."Unit Price" := UnitPrice;
        OrderLine.Insert();
    end;

    local procedure X117_ExportToXml(OrderNo: Code[20]; var Doc: XmlDocument)
    var
        Export: Codeunit "CG X117 Order Xml Export";
        ExportedXml: Text;
    begin
        Export.ExportOrder(OrderNo, ExportedXml);
        Assert.IsTrue(XmlDocument.ReadFrom(ExportedXml, Doc),
            'Expected the exported order to be a well-formed document that the receiving system can parse');
    end;

    // Composes the expected year-month-day string from the date's own parts,
    // deliberately WITHOUT going through Format's DATE handling. Deriving the
    // expectation from Format(SomeDate, 0, 9) would assert only that the
    // export matches whatever that call produces - a tautology against the
    // very mechanism the fix uses, which would keep passing on a container
    // whose locale rendered format 9 as something other than year-month-day
    // while the exported document was wrong. The two named date tests pin
    // the literal strings; this keeps the sweep independent of them.
    //
    // Format(_, 0, 9) IS used below, but only on the already-split, already-
    // ORDERED integers (Date2DMY decides the order; format 9 just renders a
    // digit string) to rule out a plain Format(YearNo) picking up a culture
    // digit-group separator on a 4-digit year (measured for Decimal in
    // decisions entry 16; not re-verified for Integer, so this stays
    // defensive) and corrupting the padding math below. That is an unrelated
    // numeric-grouping behaviour, not the date month/day/year ordering the
    // starter gets wrong, so it does not reintroduce the tautology.
    local procedure X117_IsoDay(Value: Date): Text
    var
        DayNo: Integer;
        MonthNo: Integer;
        YearNo: Integer;
    begin
        DayNo := Date2DMY(Value, 1);
        MonthNo := Date2DMY(Value, 2);
        YearNo := Date2DMY(Value, 3);
        exit(StrSubstNo('%1-%2-%3',
            PadStr('', 4 - StrLen(Format(YearNo, 0, 9)), '0') + Format(YearNo, 0, 9),
            PadStr('', 2 - StrLen(Format(MonthNo, 0, 9)), '0') + Format(MonthNo, 0, 9),
            PadStr('', 2 - StrLen(Format(DayNo, 0, 9)), '0') + Format(DayNo, 0, 9)));
    end;

    local procedure X117_AttributeValue(Doc: XmlDocument; XPath: Text): Text
    var
        Node: XmlNode;
    begin
        Assert.IsTrue(Doc.SelectSingleNode(XPath, Node), StrSubstNo('Expected the exported document to contain %1', XPath));
        exit(Node.AsXmlAttribute().Value());
    end;

    local procedure X117_ElementText(Doc: XmlDocument; XPath: Text): Text
    var
        Node: XmlNode;
    begin
        Assert.IsTrue(Doc.SelectSingleNode(XPath, Node), StrSubstNo('Expected the exported document to contain %1', XPath));
        exit(Node.AsXmlElement().InnerText());
    end;

    [Test]
    procedure X117_OrderDateReadableTwoWaysIsExportedAsOneUnambiguousDay()
    var
        Doc: XmlDocument;
    begin
        // [SCENARIO] 4 July 2026 has a day and a month that are both valid
        // read the other way around; the receiving system must not be able
        // to mistake it for a different calendar day.
        X117_Cleanup();
        X117_CreateOrder('ORD001', 'CUST001', 'Existing Customer', 20260704D);
        X117_AddLine('ORD001', 10000, 'ITEM001', 'Existing Item', 2, 100);

        X117_ExportToXml('ORD001', Doc);

        Assert.AreEqual('2026-07-04', X117_AttributeValue(Doc, '/SalesOrder/@orderDate'),
            'Expected the exported order date to name 4 July 2026 as a single, unambiguous calendar day, regardless of the server''s regional settings');
    end;

    [Test]
    procedure X117_OrderDateLaterInTheMonthIsExportedCorrectly()
    var
        Doc: XmlDocument;
    begin
        // [SCENARIO] 23 November 2026 is later in the month than the July
        // case above; the exported date must still be read correctly.
        X117_Cleanup();
        X117_CreateOrder('ORD002', 'CUST002', 'Existing Customer', 20261123D);
        X117_AddLine('ORD002', 10000, 'ITEM002', 'Existing Item', 1, 50);

        X117_ExportToXml('ORD002', Doc);

        Assert.AreEqual('2026-11-23', X117_AttributeValue(Doc, '/SalesOrder/@orderDate'),
            'Expected the exported order date to name 23 November 2026, regardless of the server''s regional settings');
    end;

    [Test]
    procedure X117_RootAttributesIdentifyTheOrderAndCustomer()
    var
        Doc: XmlDocument;
        Root: XmlElement;
    begin
        // [SCENARIO] The parts of the document that already work correctly
        // must keep working: root element name, order/customer identity,
        // and the customer's name.
        X117_Cleanup();
        X117_CreateOrder('ORD010', 'CUST010', 'Northwind Traders', 20260115D);
        X117_AddLine('ORD010', 10000, 'ITEM010', 'Blue Widget', 3, 20);

        X117_ExportToXml('ORD010', Doc);

        Assert.IsTrue(Doc.GetRoot(Root), 'Expected the exported document to have a root element');
        Assert.AreEqual('SalesOrder', Root.LocalName(), 'Expected the root element to be named SalesOrder');
        Assert.AreEqual('ORD010', X117_AttributeValue(Doc, '/SalesOrder/@no'),
            'Expected the root''s no attribute to carry the order number');
        Assert.AreEqual('CUST010', X117_AttributeValue(Doc, '/SalesOrder/@customerNo'),
            'Expected the root''s customerNo attribute to carry the customer number');
        Assert.AreEqual('Northwind Traders', X117_ElementText(Doc, '/SalesOrder/Customer/Name'),
            'Expected the Customer/Name element to carry the customer''s name');
    end;

    [Test]
    procedure X117_EveryLineIsExportedInLineNoOrderWithItsOwnValues()
    var
        Doc: XmlDocument;
        LineList: XmlNodeList;
    begin
        // [SCENARIO] Line elements come out in ascending Line No. order,
        // each carrying its own number, description, quantity and price.
        X117_Cleanup();
        X117_CreateOrder('ORD020', 'CUST020', 'Existing Customer', 20260601D);
        X117_AddLine('ORD020', 10000, 'ITEM020A', 'First Item', 2, 15.5);
        X117_AddLine('ORD020', 20000, 'ITEM020B', 'Second Item', 7, 193.7);

        X117_ExportToXml('ORD020', Doc);

        Assert.IsTrue(Doc.SelectNodes('/SalesOrder/Lines/Line', LineList),
            'Expected the exported document to contain Line elements');
        Assert.AreEqual(2, LineList.Count(), 'Expected exactly one Line element per order line');
        Assert.AreEqual('10000', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@lineNo'),
            'Expected the first Line element to carry the lower Line No.');
        Assert.AreEqual('ITEM020A', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@no'),
            'Expected the first Line element to carry the first line''s number');
        Assert.AreEqual('First Item', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@description'),
            'Expected the first Line element to carry the first line''s description');
        Assert.AreEqual('2', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@quantity'),
            'Expected a whole-number quantity to render with no decimal point');
        Assert.AreEqual('15.5', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@unitPrice'),
            'Expected the first line''s unit price to render exactly as 15.5');
        Assert.AreEqual('20000', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@lineNo'),
            'Expected the second Line element to carry the higher Line No.');
        Assert.AreEqual('ITEM020B', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@no'),
            'Expected the second Line element to carry the second line''s number');
        Assert.AreEqual('Second Item', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@description'),
            'Expected the second Line element to carry the second line''s description');
        Assert.AreEqual('7', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@quantity'),
            'Expected a whole-number quantity of 7 to render as 7, not 7.00');
        Assert.AreEqual('193.7', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@unitPrice'),
            'Expected a unit price of 193.7 to render with no trailing decimal zeros');
    end;

    [Test]
    procedure X117_LinesFromAnotherOrderAreNotIncluded()
    var
        Doc: XmlDocument;
        LineList: XmlNodeList;
    begin
        // [SCENARIO] Exporting one order must not pull in another order's
        // lines.
        X117_Cleanup();
        X117_CreateOrder('ORD030', 'CUST030', 'Existing Customer', 20260210D);
        X117_AddLine('ORD030', 10000, 'ITEM030', 'Item A', 1, 10);
        X117_CreateOrder('ORD031', 'CUST031', 'Existing Customer', 20260210D);
        X117_AddLine('ORD031', 10000, 'ITEM031', 'Item B', 5, 999);
        X117_AddLine('ORD031', 20000, 'ITEM031B', 'Item C', 6, 888);

        X117_ExportToXml('ORD030', Doc);

        Assert.IsTrue(Doc.SelectNodes('/SalesOrder/Lines/Line', LineList),
            'Expected the exported document to contain Line elements');
        Assert.AreEqual(1, LineList.Count(),
            'Expected only the exported order''s own line, not lines belonging to another order');
        Assert.AreEqual('ITEM030', X117_AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@no'),
            'Expected the single exported line to be the requested order''s own line');
    end;

    [Test]
    procedure X117_DocumentCarriesAWellFormedXmlDeclaration()
    var
        Doc: XmlDocument;
        Declaration: XmlDeclaration;
    begin
        // [SCENARIO] The receiving system's parser expects a declaration
        // stating version and encoding.
        X117_Cleanup();
        X117_CreateOrder('ORD040', 'CUST040', 'Existing Customer', 20260320D);
        X117_AddLine('ORD040', 10000, 'ITEM040', 'Existing Item', 1, 10);

        X117_ExportToXml('ORD040', Doc);

        Assert.IsTrue(Doc.GetDeclaration(Declaration),
            'Expected the exported document to start with an XML declaration');
        Assert.AreEqual('1.0', Declaration.Version(), 'Expected the XML declaration to state version 1.0');
        Assert.AreEqual('utf-8', LowerCase(Declaration.Encoding()),
            'Expected the XML declaration to state UTF-8 encoding (any casing is accepted)');
    end;

    // Not disclosed anywhere as a set: a model that only fixes the two
    // named dates above (or memorizes their expected renderings) fails
    // somewhere in this range instead of generalizing the fix. AL stops
    // at the first failing assertion, so a failing sweep discloses exactly
    // one date per attempt rather than the whole range at once. The sweep
    // starts 25 Nov 2026 and runs 41 days across a month and year
    // boundary (through 4 Jan 2027), covering single- and double-digit
    // days, single- and double-digit months, dates readable two ways
    // (month <= 12 and day <= 12, e.g. Jan 2027) and dates that are not
    // (day > 12, e.g. Nov/Dec 2026).
    [Test]
    procedure X117_OrderDateMatchesTheIsoRenderingAcrossAFullSweep()
    var
        Doc: XmlDocument;
        SweepDate: Date;
        DayOffset: Integer;
    begin
        for DayOffset := 0 to 40 do begin
            X117_Cleanup();
            SweepDate := 20261125D + DayOffset;
            X117_CreateOrder('ORDSWEEP', 'CUSTSWP', 'Existing Customer', SweepDate);
            X117_AddLine('ORDSWEEP', 10000, 'ITEMSWP', 'Existing Item', 1, 10);

            X117_ExportToXml('ORDSWEEP', Doc);

            Assert.AreEqual(X117_IsoDay(SweepDate), X117_AttributeValue(Doc, '/SalesOrder/@orderDate'),
                StrSubstNo('Expected the exported order date to identify %1 as a single calendar day, regardless of the server''s regional settings', X117_IsoDay(SweepDate)));
        end;
    end;

    [Test]
    procedure X117_ExportingAnUnknownOrderFails()
    var
        Export: Codeunit "CG X117 Order Xml Export";
        ExportedXml: Text;
    begin
        // [SCENARIO] There is no order to export, so the call must fail
        // rather than silently produce an empty or partial document.
        X117_Cleanup();

        asserterror Export.ExportOrder('NOPE', ExportedXml);
    end;

    // ==========================================================
    // X157 - donor CG-AL-X157
    // ==========================================================

    local procedure X157_ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure X157_SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure X157_SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure X157_AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure X157_SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure X157_BuildStatementForOneCostCenterLeavesAnothersRowsAlone()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260115D, 70);

        Statement.BuildStatement('CC1', 20260101D, 20260131D);
        Statement.BuildStatement('CC2', 20260101D, 20260131D);

        X157_AssertStatementLine('CC1', 20260101D, 100, 'Another cost center''s statement rows must survive building this one''s');
        X157_AssertStatementLine('CC2', 20260101D, 70, 'The freshly built cost center''s own row must carry its own amount');
    end;

    [Test]
    procedure X157_StatementSpanningYearEndCarriesEachMonthsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20261210D, 90);
        X157_SeedEntry('CC1', 20270115D, 35);

        Statement.BuildStatement('CC1', 20261201D, 20270131D);

        X157_AssertStatementLine('CC1', 20261201D, 90, 'The December period of a statement spanning year end carries December''s own figure');
        X157_AssertStatementLine('CC1', 20270101D, 35, 'The January period of a statement spanning year end carries January''s own figure');
    end;

    [Test]
    procedure X157_MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure X157_NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure X157_StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        X157_AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        X157_AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure X157_WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure X157_AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure X157_ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20251231D, 20);
        X157_SeedEntry('CC1', 20260101D, 100);
        X157_SeedEntry('CC1', 20260131D, 50);
        X157_SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure X157_RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;

    // ==========================================================
    // X170 - donor CG-AL-X170
    // ==========================================================

    local procedure X170_ClearAllData()
    var
        ReversalLine: Record "CG X170 Reversal Line";
        CostCenter: Record "CG X170 Cost Center";
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ReversalLine.DeleteAll();
        CostCenter.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure X170_SeedCharge(ChargeNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := ChargeNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure X170_SeedCostCenter(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal)
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Charge No." := ChargeNo;
        CostCenter."Line No." := LineNo;
        CostCenter."Cost Center Name" := CostCenterName;
        CostCenter.Weight := CCWeight;
        CostCenter.Insert();
    end;

    local procedure X170_SeedCostCenterWithSentinel(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal; SentinelAmount: Decimal)
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Charge No." := ChargeNo;
        CostCenter."Line No." := LineNo;
        CostCenter."Cost Center Name" := CostCenterName;
        CostCenter.Weight := CCWeight;
        CostCenter."Allocated Amount" := SentinelAmount;
        CostCenter.Insert();
    end;

    local procedure X170_SeedReversalLineSentinel(ChargeNo: Code[20]; ReversalNo: Code[20]; CostCenterLineNo: Integer; SentinelAmount: Decimal)
    var
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        ReversalLine.Init();
        ReversalLine."Charge No." := ChargeNo;
        ReversalLine."Reversal No." := ReversalNo;
        ReversalLine."Cost Center Line No." := CostCenterLineNo;
        ReversalLine."Reversed Amount" := SentinelAmount;
        ReversalLine.Insert();
    end;

    local procedure X170_GetCCAllocated(ChargeNo: Code[20]; LineNo: Integer): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Get(ChargeNo, LineNo);
        exit(CostCenter."Allocated Amount");
    end;

    // Reads a cost center's net remaining amount directly off the raw
    // stored records - CostCenter."Allocated Amount" and the actual
    // "CG X170 Reversal Line" rows recorded against it - bypassing
    // Allocator.GetNetAmount entirely. A candidate could otherwise keep
    // ReverseCharge's stored per-cost-center rows wrong and pass every
    // assertion in this file by rewriting ONLY GetNetAmount to recompute
    // a fresh share on demand from the charge-level totals
    // (GetAllocatedTotal minus GetChargeReversedTotal), never looking at
    // what ReverseCharge actually wrote per cost center. This helper
    // pins what is actually on disk, so that rewrite still fails.
    local procedure X170_GetRawNet(ChargeNo: Code[20]; CostCenterLineNo: Integer): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        CostCenter.Get(ChargeNo, CostCenterLineNo);
        ReversalLine.SetRange("Charge No.", ChargeNo);
        ReversalLine.SetRange("Cost Center Line No.", CostCenterLineNo);
        ReversalLine.CalcSums("Reversed Amount");
        exit(CostCenter."Allocated Amount" - ReversalLine."Reversed Amount");
    end;

    // Independently reconstructs the allocation every correct
    // implementation must produce: floor everyone's exact proportional
    // share to the cent, then hand out whatever the floors left on the
    // table one cent at a time to whichever entity's exact entitlement
    // was rounded down by the most, tie-broken by the lower array index.
    // A zero-weight entity's remainder is always exactly zero, so it
    // never competes for a leftover cent. This is the reference this
    // oracle grades against - not a re-implementation that happens to
    // agree with one particular solution.
    //
    // The description licenses no particular tie-break rule, so this
    // reference's "lower array index wins" choice is only safe to grade
    // against when no two nonzero-weight items actually tie on their
    // exact remainder for a given call. The hand-picked fixtures
    // elsewhere in this file were chosen to avoid that (see their own
    // comments); the deterministic sweep draws random weights, so it
    // exposes Remainder to self-check for ties before trusting this
    // reference's tie-break as the expected value.
    local procedure X170_ComputeSharesByLargestRemainder(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal; var Remainder: array[10] of Decimal)
    var
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to ItemCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to ItemCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to ItemCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" would index Remainder[0] on the
                    // first candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if Remainder[i] > Remainder[WinnerIndex] then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X170_SingleCostCenterGetsTheEntireChargeAndAFullReversalNetsToZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('SP01', 246.80);
        X170_SeedCostCenter('SP01', 1, 'Solo Cost Center', 17);

        Allocator.AllocateCharge('SP01');
        Assert.AreEqual(246.80, X170_GetCCAllocated('SP01', 1), 'Expected a charge with a single cost center to allocate its entire total to that cost center');

        Allocator.ReverseCharge('SP01', 'R1', 246.80);
        Assert.AreEqual(246.80, Allocator.GetReversedTotal('SP01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('SP01', 1), 'Expected a full reversal against a single-cost-center charge to leave that cost center owing exactly nothing');
    end;

    [Test]
    procedure X170_CleanEvenSplitReconcilesExactlyAndLeavesAnotherChargeUntouched()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('CD01', 200.00);
        X170_SeedCostCenter('CD01', 1, 'CC East', 1);
        X170_SeedCostCenter('CD01', 2, 'CC West', 1);

        // A second, unrelated charge is seeded with its own nonzero
        // sentinel amounts - on its cost center AND on an already
        // recorded reversal - and left alone. Allocating and reversing
        // CD01 must not touch any of it.
        X170_SeedCharge('XB01', 999.00);
        X170_SeedCostCenterWithSentinel('XB01', 1, 'CC Untouched', 1, 555.55);
        X170_SeedReversalLineSentinel('XB01', 'R1', 1, 111.11);

        Allocator.AllocateCharge('CD01');
        Allocator.ReverseCharge('CD01', 'R1', 50.00);

        Assert.AreEqual(100.00, X170_GetCCAllocated('CD01', 1), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(100.00, X170_GetCCAllocated('CD01', 2), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('CD01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 1), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 2), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');

        ChargeHeader.Get('CD01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge whose cost centers carry weight to be recorded as allocated once its total has been spread across them');

        ChargeHeader.Get('XB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected an untouched charge to stay unallocated');
        Assert.AreEqual(555.55, X170_GetCCAllocated('XB01', 1), 'Expected another charge''s cost center amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(555.55, Allocator.GetAllocatedTotal('XB01'), 'Expected another charge''s allocated-total reconciliation to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(111.11, Allocator.GetReversedTotal('XB01', 'R1'), 'Expected another charge''s already-recorded reversal amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(444.44, Allocator.GetNetAmount('XB01', 1), 'Expected another charge''s net remaining amount to be left untouched by allocating or reversing a different charge');
    end;

    [Test]
    procedure X170_AdversarialFourCostCenterAllocationMatchesExactCents()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
        GrandTotal: Decimal;
        i: Integer;
    begin
        // Weights chosen so every cost center's exact share has a
        // distinct rounding remainder (no ties), so the pinned amounts
        // below do not depend on any particular tie-break policy.
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');

        Assert.AreEqual(135.25, X170_GetCCAllocated('AD01', 1), 'Expected CC Facilities''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(127.05, X170_GetCCAllocated('AD01', 2), 'Expected CC Operations''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(122.95, X170_GetCCAllocated('AD01', 3), 'Expected CC Support''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(114.75, X170_GetCCAllocated('AD01', 4), 'Expected CC Admin''s recorded amount to depend only on the charge''s weights and total');

        GrandTotal := 0;
        for i := 1 to 4 do
            GrandTotal += X170_GetCCAllocated('AD01', i);
        Assert.AreEqual(500.00, GrandTotal, 'Expected every cost center''s recorded amount to sum to exactly the charge''s total amount');
        Assert.AreEqual(500.00, Allocator.GetAllocatedTotal('AD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
    end;

    [Test]
    procedure X170_NetAfterAPartialReversalMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 50.00);

        Assert.AreEqual(50.00, Allocator.GetReversedTotal('AD01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(121.72, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(450.00, Allocator.GetNetAmount('AD01', 1) + Allocator.GetNetAmount('AD01', 2) + Allocator.GetNetAmount('AD01', 3) + Allocator.GetNetAmount('AD01', 4), 'Expected every cost center''s net remaining amount to sum to exactly the total amount not yet reversed');
    end;

    [Test]
    procedure X170_NetAfterAPartialReversalOnASecondAdversarialRatioMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD02', 300.00);
        X170_SeedCostCenter('AD02', 1, 'CC North', 17);
        X170_SeedCostCenter('AD02', 2, 'CC South', 13);
        X170_SeedCostCenter('AD02', 3, 'CC East', 9);
        X170_SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 30.00);

        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(104.32, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(79.77, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(55.23, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(30.68, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure X170_SomeReversalAmountsHappenToReconcileEvenOnTheBrokenImplementation()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        // Same charge shape as the second adversarial ratio above, but a
        // different reversal amount - one where a plausible-but-wrong
        // implementation happens to land on the same cent split as the
        // correct one. This is expected to pass on any implementation
        // that gets the allocation side right, correct or not.
        X170_ClearAllData();
        X170_SeedCharge('AD02', 300.00);
        X170_SeedCostCenter('AD02', 1, 'CC North', 17);
        X170_SeedCostCenter('AD02', 2, 'CC South', 13);
        X170_SeedCostCenter('AD02', 3, 'CC East', 9);
        X170_SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 100.00);

        Assert.AreEqual(100.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(77.27, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(59.09, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(40.91, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(22.73, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure X170_FullyReversingAChargeInTwoStepsLeavesEveryCostCenterAtExactlyZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 6.00);

        Assert.AreEqual(133.62, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(125.52, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(121.48, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(113.38, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');

        Allocator.ReverseCharge('AD01', 'R2', 494.00);

        Assert.AreEqual(500.00, Allocator.GetChargeReversedTotal('AD01'), 'Expected every reversal recorded against a charge to sum to exactly the amounts they were each for');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 1), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 2), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 3), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 4), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
    end;

    [Test]
    procedure X170_TwoSequentialPartialReversalsConserveCumulativelyAgainstTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 50.00);

        Assert.AreEqual(121.72, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(121.72, X170_GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, X170_GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, X170_GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, X170_GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');

        Allocator.ReverseCharge('AD01', 'R2', 30.00);

        Assert.AreEqual(80.00, Allocator.GetChargeReversedTotal('AD01'), 'Expected every reversal recorded against a charge to sum to exactly the amounts they were each for');
        Assert.AreEqual(113.61, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(113.61, X170_GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, X170_GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, X170_GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, X170_GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('AD01', 'R1'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD01', 'R2'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
    end;

    [Test]
    procedure X170_ZeroWeightCostCenterNeverReceivesOrGivesBackAnyShare()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('ZW01', 90.00);
        X170_SeedCostCenter('ZW01', 1, 'CC Live', 5);
        X170_SeedCostCenter('ZW01', 2, 'CC Sample', 0);

        Allocator.AllocateCharge('ZW01');
        Assert.AreEqual(90.00, X170_GetCCAllocated('ZW01', 1), 'Expected a cost center with weight to receive its full proportional share when the only other cost center on the charge has none');
        Assert.AreEqual(0.00, X170_GetCCAllocated('ZW01', 2), 'Expected a cost center with no weight to receive exactly zero, even though another cost center on the same charge carries a nonzero total');

        Allocator.ReverseCharge('ZW01', 'R1', 30.00);
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('ZW01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(60.00, Allocator.GetNetAmount('ZW01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('ZW01', 2), 'Expected a cost center with no weight to give back exactly zero of any reversal and keep a net remaining amount of exactly zero, regardless of the reversal amount');
    end;

    [Test]
    procedure X170_AChargeWithNoWeightAnywhereIsNeverAllocated()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('NB01', 60.00);
        X170_SeedCostCenterWithSentinel('NB01', 1, 'CC Idle A', 0, 11.11);
        X170_SeedCostCenterWithSentinel('NB01', 2, 'CC Idle B', 0, 33.33);

        Allocator.AllocateCharge('NB01');

        ChargeHeader.Get('NB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any cost center to be left unallocated');
        Assert.AreEqual(11.11, X170_GetCCAllocated('NB01', 1), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(33.33, X170_GetCCAllocated('NB01', 2), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(44.44, Allocator.GetAllocatedTotal('NB01'), 'Expected the charge-level reconciliation total to reflect the charge''s own recorded cost center amounts even when the charge was never allocated');
    end;

    [Test]
    procedure X170_DeterministicSweepAcrossManyChargesAndReversalSequences()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
        Any: Codeunit Any;
        Weight: array[10] of Decimal;
        ExpectedNet: array[10] of Decimal;
        Remainder: array[10] of Decimal;
        ChargeNo: Code[20];
        CCCount: Integer;
        TotalCents: Integer;
        R1Cents: Integer;
        R2Cents: Integer;
        TotalAmount: Decimal;
        R1Amount: Decimal;
        R2Amount: Decimal;
        RemainingTotal: Decimal;
        Partition: Integer;
        i: Integer;
        a: Integer;
        b: Integer;
    begin
        Any.SetSeed(170);

        for Partition := 1 to 6 do begin
            X170_ClearAllData();
            ChargeNo := 'SW' + Format(Partition);
            CCCount := Any.IntegerInRange(3, 6);

            for i := 1 to CCCount do begin
                // Roughly every fourth cost center on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X170_SeedCostCenter(ChargeNo, i, StrSubstNo('Sweep cost center %1', i), Weight[i]);
            end;

            TotalCents := Any.IntegerInRange(10000, 99900);
            TotalAmount := TotalCents / 100;
            X170_SeedCharge(ChargeNo, TotalAmount);

            Allocator.AllocateCharge(ChargeNo);

            R1Cents := Any.IntegerInRange(1, TotalCents - 2);
            R2Cents := Any.IntegerInRange(1, TotalCents - R1Cents - 1);
            R1Amount := R1Cents / 100;
            R2Amount := R2Cents / 100;

            Allocator.ReverseCharge(ChargeNo, 'R1', R1Amount);
            Allocator.ReverseCharge(ChargeNo, 'R2', R2Amount);

            Assert.AreEqual(
              R1Amount + R2Amount, Allocator.GetChargeReversedTotal(ChargeNo),
              StrSubstNo('Expected every reversal recorded against sweep partition %1''s charge to sum to exactly the amounts they were each for', Partition));

            RemainingTotal := TotalAmount - R1Amount - R2Amount;
            X170_ComputeSharesByLargestRemainder(Weight, CCCount, RemainingTotal, ExpectedNet, Remainder);

            // The description licenses no tie-break rule, so a tie
            // between two nonzero-weight cost centers' exact remainders
            // would make this fixture's pinned expectation depend on a
            // rule the task never stated - not a real defect in any
            // implementation. Self-check rather than silently trust the
            // reference's "lower index wins" choice on a random draw.
            for a := 1 to CCCount do
                if Weight[a] <> 0 then
                    for b := a + 1 to CCCount do
                        if Weight[b] <> 0 then
                            Assert.AreNotEqual(
                              Remainder[a], Remainder[b],
                              StrSubstNo('Sweep fixture drew a remainder tie on partition %1 - re-seed the sweep, this is not a solution defect', Partition));

            for i := 1 to CCCount do begin
                Assert.AreEqual(
                  ExpectedNet[i], Allocator.GetNetAmount(ChargeNo, i),
                  StrSubstNo('Expected cost center %1 of reversal-sweep partition %2 to end up with a net remaining amount that matches a clean allocation of whatever is left of the charge, after two separate reversals', i, Partition));
                Assert.AreEqual(
                  ExpectedNet[i], X170_GetRawNet(ChargeNo, i),
                  StrSubstNo('Expected cost center %1 of reversal-sweep partition %2 to end up with a net remaining amount that matches a clean allocation of whatever is left of the charge, after two separate reversals', i, Partition));
            end;
        end;
    end;
}
