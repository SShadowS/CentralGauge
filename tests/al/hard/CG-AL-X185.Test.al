codeunit 89407 "CG-AL-X185 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 4 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every record-driven test
        // clears the table before seeding its own rows. Untouched claims are
        // seeded with a nonzero sentinel amount so "untouched" and
        // "recalculated to zero" stay distinguishable.
        Consolidator: Codeunit "CG X162 Consolidator";
        SetupMgt: Codeunit "CG X162 Setup Mgt";
        // Companies are enumerated at runtime, never hardcoded. Every test that
        // touches the other company clears both companies' source readings and
        // the collected list BEFORE seeding and AGAIN before asserting, and
        // Commit()s each clear - so cleanup is durable even if an assertion in
        // the same test raises an error. Meter numbers are prefixed per
        // company (H.. / O..) so a run never has to overwrite one company's row
        // with the other's value, keeping row-count and total assertions
        // independent of which company a reading ends up filed under.

    // ==========================================================
    // X092 - donor CG-AL-X092
    // ==========================================================

    local procedure X092_AssertDecimalRoundTrips(Original: Decimal)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Decimal;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDecimal(Original);

        Assert.IsTrue(WireFormat.FromWireDecimal(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original amount %2', WireText, Original));
    end;

    local procedure X092_AssertDateRoundTrips(Original: Date)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Date;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDate(Original);

        Assert.IsTrue(WireFormat.FromWireDate(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original date %2', WireText, Original));
    end;

    [Test]
    procedure X092_ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure X092_ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure X092_ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure X092_ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure X092_ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure X092_ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsCommaFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDecimal('1,5', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 1,5 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure X092_FromWireDateRejectsLocaleFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDate('05-02-2026', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 05-02-2026 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDecimalRoundTrips(1000);
        X092_AssertDecimalRoundTrips(12345.67);
        X092_AssertDecimalRoundTrips(-98765.43);
        X092_AssertDecimalRoundTrips(2000000);
        X092_AssertDecimalRoundTrips(-1500.25);
        X092_AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure X092_DateRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        X092_AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        X092_AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        X092_AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;

    // ==========================================================
    // X076 - donor CG-AL-X076
    // ==========================================================

    local procedure X076_Reset()
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.DeleteAll();
    end;

    local procedure X076_EntryExists(EntryCode: Code[20]): Boolean
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        exit(LegacyAmount.Get(EntryCode));
    end;

    local procedure X076_AmountOf(EntryCode: Code[20]): Decimal
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.Get(EntryCode);
        exit(LegacyAmount.Amount);
    end;

    [Test]
    procedure X076_ParseAmountReturnsTheValueOfAValidAmountText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.AreEqual(Amount, Importer.ParseAmount(Format(Amount)),
            'Expected ParseAmount to return the decimal value of a well-formed amount text');
    end;

    [Test]
    procedure X076_ParseAmountAcceptsZero()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        Assert.AreEqual(0.0, Importer.ParseAmount('0'),
            'Expected ParseAmount to accept zero - only negative amounts are invalid');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnTextThatIsNotANumber()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        asserterror Importer.ParseAmount('X76-garbage');

        Assert.ExpectedError('''X76-garbage'' is not a valid amount');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        NegativeText: Text;
    begin
        NegativeText := Format(-Any.DecimalInRange(1, 900, 2));

        asserterror Importer.ParseAmount(NegativeText);

        Assert.ExpectedError(StrSubstNo('''%1'' is not a valid amount', NegativeText));
    end;

    [Test]
    procedure X076_TryParseAmountReturnsTrueAndTheValueForAValidText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Expected: Decimal;
        Amount: Decimal;
        FailureReason: Text;
    begin
        Expected := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.TryParseAmount(Format(Expected), Amount, FailureReason),
            'Expected TryParseAmount to return true for a well-formed amount text');
        Assert.AreEqual(Expected, Amount, 'Expected TryParseAmount to put the parsed value into Amount');
        Assert.AreEqual('', FailureReason, 'Expected an empty FailureReason after a successful conversion');
    end;

    [Test]
    procedure X076_TryParseAmountReturnsFalseWithTheReasonInsteadOfFailing()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        // No asserterror: TryParseAmount must never raise, whatever the input.
        Assert.IsFalse(Importer.TryParseAmount('X76-not-a-number', Amount, FailureReason),
            'Expected TryParseAmount to return false for text that does not parse as an amount');
        Assert.IsTrue(FailureReason.Contains('''X76-not-a-number'' is not a valid amount'),
            StrSubstNo('Expected FailureReason to carry the conversion error text, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_TryParseAmountReportsTheLatestFailure()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        Importer.TryParseAmount('X76-first-bad', Amount, FailureReason);

        Importer.TryParseAmount('X76-second-bad', Amount, FailureReason);

        Assert.IsTrue(FailureReason.Contains('X76-second-bad'),
            StrSubstNo('Expected FailureReason to describe the latest failed input, got "%1"', FailureReason));
        Assert.IsFalse(FailureReason.Contains('X76-first-bad'),
            StrSubstNo('Expected FailureReason to no longer mention the earlier failed input, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANonNumericAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD1', 'X76-not-a-number'),
            'Expected ImportLine to return false for text that does not parse as an amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD1'), 'Expected no stored entry for an amount that failed to parse');
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD2', Format(-Any.DecimalInRange(1, 900, 2))),
            'Expected ImportLine to return false for a negative amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD2'), 'Expected no stored entry for a rejected negative amount');
    end;

    [Test]
    procedure X076_ImportLineImportsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        X076_Reset();
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.ImportLine('X76-V1', Format(Amount)),
            'Expected a well-formed, non-negative amount to be reported as imported');
        Assert.IsTrue(X076_EntryExists('X76-V1'), 'Expected a stored entry for the imported line');
        Assert.AreEqual(Amount, X076_AmountOf('X76-V1'), 'Expected the stored entry to carry the parsed amount');
    end;

    [Test]
    procedure X076_ImportLineAcceptsZeroAsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsTrue(Importer.ImportLine('X76-ZERO', '0'),
            'Expected a zero amount to be reported as imported, not rejected - zero is well-formed and non-negative');
        Assert.IsTrue(X076_EntryExists('X76-ZERO'), 'Expected a stored entry for the zero-amount line');
        Assert.AreEqual(0, X076_AmountOf('X76-ZERO'), 'Expected the stored entry to carry an amount of exactly zero');
    end;

    [Test]
    procedure X076_BatchSkipsEveryBadLineAndImportsNothing()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
    begin
        X076_Reset();
        Codes.Add('X76-B1A');
        Texts.Add('X76-not-a-number');
        Codes.Add('X76-B1B');
        Texts.Add(Format(-Any.DecimalInRange(1, 900, 2)));

        Assert.AreEqual(0, Job.ImportBatch(Codes, Texts),
            'Expected a batch of only malformed or negative lines to import nothing');
        Assert.IsFalse(X076_EntryExists('X76-B1A'), 'Expected no stored entry for the malformed line');
        Assert.IsFalse(X076_EntryExists('X76-B1B'), 'Expected no stored entry for the negative line');
    end;

    [Test]
    procedure X076_BatchImportsEveryWellFormedLineAndCountsThem()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        Amount1: Decimal;
        Amount2: Decimal;
        Amount3: Decimal;
    begin
        X076_Reset();
        Amount1 := Any.DecimalInRange(1, 300, 2);
        Amount2 := Any.DecimalInRange(1, 300, 2);
        Amount3 := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B2A');
        Texts.Add(Format(Amount1));
        Codes.Add('X76-B2B');
        Texts.Add(Format(Amount2));
        Codes.Add('X76-B2C');
        Texts.Add(Format(Amount3));

        Assert.AreEqual(3, Job.ImportBatch(Codes, Texts),
            'Expected every well-formed line in the batch to be counted as imported');
        Assert.AreEqual(Amount1, X076_AmountOf('X76-B2A'), 'Expected the first line''s parsed amount to be stored');
        Assert.AreEqual(Amount2, X076_AmountOf('X76-B2B'), 'Expected the second line''s parsed amount to be stored');
        Assert.AreEqual(Amount3, X076_AmountOf('X76-B2C'), 'Expected the third line''s parsed amount to be stored');
    end;

    [Test]
    procedure X076_BatchCountsOnlyTheWellFormedLinesInAMixedBatch()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        GoodAmount: Decimal;
    begin
        X076_Reset();
        GoodAmount := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B3BAD');
        Texts.Add('X76-still-not-a-number');
        Codes.Add('X76-B3GOOD');
        Texts.Add(Format(GoodAmount));

        Assert.AreEqual(1, Job.ImportBatch(Codes, Texts),
            'Expected only the well-formed line to be counted as imported');
        Assert.IsFalse(X076_EntryExists('X76-B3BAD'), 'Expected no stored entry for the malformed line');
        Assert.IsTrue(X076_EntryExists('X76-B3GOOD'), 'Expected a stored entry for the well-formed line');
        Assert.AreEqual(GoodAmount, X076_AmountOf('X76-B3GOOD'), 'Expected the well-formed line''s parsed amount to be stored');
    end;

    // ==========================================================
    // X114 - donor CG-AL-X114
    // ==========================================================

    local procedure X114_Seed(EntryNo: Integer; AwayMinutes: Integer; InitialAmount: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Init();
        Claim."Entry No." := EntryNo;
        Claim."Away Minutes" := AwayMinutes;
        Claim."Allowance Amount" := InitialAmount;
        Claim.Insert();
    end;

    local procedure X114_Recalc(EntryNo: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Claim.Get(EntryNo);
        AllowanceCalc.RecalculateClaim(Claim);
    end;

    local procedure X114_AmountOf(EntryNo: Integer): Integer
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Get(EntryNo);
        exit(Claim."Allowance Amount");
    end;

    // Independent reference ladder the sweeps below grade against -
    // deliberately not shared with the application code under test.
    local procedure X114_ExpectedAmountFor(AwayMinutes: Integer): Integer
    begin
        if AwayMinutes >= 720 then
            exit(500);
        if AwayMinutes > 360 then
            exit(250);
        exit(0);
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearSixHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 350 to 370 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearTwelveHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 710 to 730 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_TheShortestAndLongestTripsResolveToTheOuterTiers()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(-30), 'A negative away-time must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(0), 'A zero-minute trip must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(1), 'A 1-minute trip must resolve to no allowance');
        Assert.AreEqual(500, AllowanceCalc.CalculateAllowance(1440), 'A 1440-minute trip must resolve to the full allowance');
    end;

    [Test]
    procedure X114_TheOvertimeBandClassificationStaysCorrect()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(200), 'A 200-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(500), 'A 500-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(800), 'An 800-minute trip must classify into the full-allowance band');

        // The statistics classification must keep matching the confirmed
        // amount schedule at the same away-times CalculateAllowance is
        // graded on - a rewrite that simplifies away how OvertimeBandOf
        // decides each side of these away-times must not go ungraded.
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(359), 'A 359-minute trip must classify into the no-allowance band');
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(360), 'A 360-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(361), 'A 361-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(719), 'A 719-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(720), 'A 720-minute trip must classify into the full-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(721), 'A 721-minute trip must classify into the full-allowance band');
    end;

    [Test]
    procedure X114_RecalculatingAClaimWritesTheConfirmedAmountBackToTheRecord()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(1, 500, 999);

        X114_Recalc(1);

        Assert.AreEqual(250, X114_AmountOf(1), 'Recalculating a claim must store the confirmed allowance amount back onto the claim');
    end;

    [Test]
    procedure X114_RecalculatingOneClaimLeavesOtherClaimsUntouched()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(2, 500, 999);
        X114_Seed(3, 800, 777);

        X114_Recalc(2);

        Assert.AreEqual(250, X114_AmountOf(2), 'The recalculated claim must resolve to the confirmed allowance amount');
        Assert.AreEqual(777, X114_AmountOf(3), 'A claim that was not recalculated must keep its existing allowance amount');
    end;

    [Test]
    procedure X114_RecalculatingTheSameClaimTwiceIsStable()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(4, 500, 0);

        X114_Recalc(4);
        X114_Recalc(4);

        Assert.AreEqual(250, X114_AmountOf(4), 'Recalculating the same claim twice must not change the result');
    end;

    // ==========================================================
    // X162 - donor CG-AL-X162
    // ==========================================================

    local procedure X162_GetOtherCompanyName(): Text[30]
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

    local procedure X162_ClearHomeMeterReadings()
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.DeleteAll();
    end;

    local procedure X162_ClearOtherMeterReadings(OtherName: Text[30])
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.ChangeCompany(OtherName);
        MeterReading.DeleteAll();
    end;

    local procedure X162_ClearCollected()
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        CollectedReading.DeleteAll();
    end;

    local procedure X162_ClearAll(OtherName: Text[30])
    begin
        X162_ClearHomeMeterReadings();
        X162_ClearOtherMeterReadings(OtherName);
        X162_ClearCollected();
        Commit();
    end;

    local procedure X162_SumAllCollected(): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure X162_SumCollectedForCompany(SourceCompanyName: Text[30]): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        CollectedReading.SetRange("Source Company", SourceCompanyName);
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure X162_CountAllCollected(): Integer
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        exit(CollectedReading.Count());
    end;

    [Test]
    procedure X162_TheOverallCollectedTotalIsCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Total: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        Total := X162_SumAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(19.0, Total,
            'Expected the collected list''s total quantity to equal the sum of every reading collected from every company');
    end;

    [Test]
    procedure X162_ReadingsFromTheOtherCompanyAreFiledUnderTheCompanyTheyCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        FiledUnderOther: Boolean;
        MisfiledUnderHome: Boolean;
        OtherQty: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        FiledUnderOther := CollectedReading.Get(OtherName, 'O1');
        if FiledUnderOther then
            OtherQty := CollectedReading.Quantity;
        MisfiledUnderHome := CollectedReading.Get(HomeName, 'O1');

        X162_ClearAll(OtherName);

        Assert.IsTrue(FiledUnderOther,
            'Expected the reading recorded by the other company to be filed in the collected list under the other company');
        Assert.AreEqual(9.0, OtherQty,
            'Expected the reading filed under the other company to keep its own recorded quantity');
        Assert.IsFalse(MisfiledUnderHome,
            'Expected the reading recorded by the other company not to be filed under this company');
    end;

    [Test]
    procedure X162_TheHomeCompanysOwnReadingIsFiledUnderItself()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        Filed: Boolean;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        Filed := CollectedReading.Get(HomeName, 'H1');

        X162_ClearAll(OtherName);

        Assert.IsTrue(Filed,
            'Expected this company''s own reading to be filed under this company');
        Assert.AreEqual(5.0, CollectedReading.Quantity,
            'Expected this company''s own reading to keep its own recorded quantity');
    end;

    [Test]
    procedure X162_SubtotalsPerCompanyReflectWhereEachReadingCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeSubtotal: Decimal;
        OtherSubtotal: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        HomeSubtotal := X162_SumCollectedForCompany(HomeName);
        OtherSubtotal := X162_SumCollectedForCompany(OtherName);

        X162_ClearAll(OtherName);

        Assert.AreEqual(8.0, HomeSubtotal,
            'Expected the subtotal filed under this company to equal only the readings this company recorded');
        Assert.AreEqual(11.0, OtherSubtotal,
            'Expected the subtotal filed under the other company to equal only the readings the other company recorded');
    end;

    [Test]
    procedure X162_ACompanyWithNoReadingsContributesNothingToTheCollectedList()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCount: Integer;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        RowCount := X162_CountAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(1, RowCount,
            'Expected a company with no readings to add nothing to the collected list');
    end;

    [Test]
    procedure X162_SourceMeterReadingsAreUnchangedAfterCollection()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeQtyAfter: Decimal;
        OtherQtyAfter: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        HomeQtyAfter := SetupMgt.GetMeterReading(HomeName, 'H1');
        OtherQtyAfter := SetupMgt.GetMeterReading(OtherName, 'O1');

        X162_ClearAll(OtherName);

        Assert.AreEqual(5.0, HomeQtyAfter,
            'Expected this company''s recorded meter reading to be unchanged by collecting it into the list');
        Assert.AreEqual(9.0, OtherQtyAfter,
            'Expected the other company''s recorded meter reading to be unchanged by collecting it into the list');
    end;

    [Test]
    procedure X162_RunningCollectionAgainReplacesEachReadingRatherThanDuplicatingIt()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCountAfterFirstRun: Integer;
        RowCountAfterSecondRun: Integer;
        TotalAfterFirstRun: Decimal;
        TotalAfterSecondRun: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();
        RowCountAfterFirstRun := X162_CountAllCollected();
        TotalAfterFirstRun := X162_SumAllCollected();

        SetupMgt.SetMeterReading(HomeName, 'H1', 8);
        Consolidator.CollectReadings();
        RowCountAfterSecondRun := X162_CountAllCollected();
        TotalAfterSecondRun := X162_SumAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(RowCountAfterFirstRun, RowCountAfterSecondRun,
            'Expected running the collection again to replace each company''s reading rather than adding another row for it');
        Assert.AreEqual(14.0, TotalAfterFirstRun,
            'Expected the first collection to total the readings recorded at that point');
        Assert.AreEqual(17.0, TotalAfterSecondRun,
            'Expected collecting again after a reading changed to reflect its newly recorded quantity rather than the old one');
    end;
}
