codeunit 89485 "CG-AL-X263 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 6 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // every test clears both tables before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.

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
    // X107 - donor CG-AL-X107
    // ==========================================================

    local procedure X107_Reset()
    var
        DealHeader: Record "CG X107 Deal Header";
        PostedDeal: Record "CG X107 Posted Deal";
    begin
        DealHeader.DeleteAll();
        PostedDeal.DeleteAll();
    end;

    local procedure X107_SeedDeal(No: Code[20]; DealReference: Text[30]; Amount: Decimal)
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
    procedure X107_PostedDealCarriesTheDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D001', 'REF-ALPHA-0001-XXXXXXXXXXXXXX', 100);

        Poster.PostDeal('D001');

        PostedDeal.Get('D001');
        Assert.AreEqual('REF-ALPHA-0001-XXXXXXXXXXXXXX', PostedDeal."Deal Reference",
            'Expected the posted deal to carry the deal reference recorded at posting time');
    end;

    [Test]
    procedure X107_PostedDealCarriesADifferentDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D002', 'REF-BETA-9999-YYYYYYYYYYYYYYY', 250);

        Poster.PostDeal('D002');

        PostedDeal.Get('D002');
        Assert.AreEqual('REF-BETA-9999-YYYYYYYYYYYYYYY', PostedDeal."Deal Reference",
            'Expected the posted deal to carry this deal header''s own reference');
    end;

    [Test]
    procedure X107_PostingKeepsTheAmountThePosterAssigns()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D003', 'REF-GAMMA-1234-ZZZZZZZZZZZZZZ', 777.5);

        Poster.PostDeal('D003');

        PostedDeal.Get('D003');
        Assert.AreEqual(777.5, PostedDeal.Amount,
            'Expected the posted deal to keep the amount recorded when it was posted');
    end;

    [Test]
    procedure X107_PostingOneDealDoesNotChangeAnotherAlreadyPostedDeal()
    var
        OtherPostedDeal: Record "CG X107 Posted Deal";
        NewPostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        OtherPostedDeal.Init();
        OtherPostedDeal."No." := 'EXIST';
        OtherPostedDeal."Deal Reference" := 'REF-EXISTING-SENTINEL-000000';
        OtherPostedDeal.Amount := 555;
        OtherPostedDeal.Insert();

        X107_SeedDeal('D004', 'REF-DELTA-4444-WWWWWWWWWWWWWW', 42);
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

    // ==========================================================
    // X126 - donor CG-AL-X126
    // ==========================================================

    [Test]
    procedure X126_ReservesABoxFor100x40AtMaximum50()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 50
        // [THEN] the reserved box is 50x20
        X126_VerifyThumbnailSize(100, 40, 50, 50, 20, '100x40 with a maximum of 50');
    end;

    [Test]
    procedure X126_ReservesABoxFor40x100AtMaximum50()
    begin
        // [WHEN] reserving a box for a 40x100 original with a maximum of 50
        // [THEN] the reserved box is 20x50
        X126_VerifyThumbnailSize(40, 100, 50, 20, 50, '40x100 with a maximum of 50');
    end;

    [Test]
    procedure X126_ReservesABoxFor80x80AtMaximum32()
    begin
        // [WHEN] reserving a box for an 80x80 original with a maximum of 32
        // [THEN] the reserved box is 32x32
        X126_VerifyThumbnailSize(80, 80, 32, 32, 32, '80x80 with a maximum of 32');
    end;

    [Test]
    procedure X126_ReservesABoxFor100x40AtMaximum64()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 64
        // [THEN] the reserved box is 64x26
        X126_VerifyThumbnailSize(100, 40, 64, 64, 26, '100x40 with a maximum of 64');
    end;

    [Test]
    procedure X126_ReservesABoxFor20x10AtMaximum15()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of 15
        // [THEN] the reserved box is 15x8
        X126_VerifyThumbnailSize(20, 10, 15, 15, 8, '20x10 with a maximum of 15');
    end;

    // Protects the disclosed 41 -> 16 (not 17) example. Left exactly as
    // authored: it passes on the starter, and it must keep passing on the
    // starter, because it is the only disclosed example that rules out an
    // always-round-up "fix" - see NOTES.md.
    [Test]
    procedure X126_ReservesABoxFor100x40AtMaximum41()
    begin
        // [WHEN] reserving a box for a 100x40 original with a maximum of 41
        // [THEN] the reserved box is 41x16, not 41x17
        X126_VerifyThumbnailSize(100, 40, 41, 41, 16, '100x40 with a maximum of 41');
    end;

    [Test]
    procedure X126_ReservesABoxFor20x10AtMaximum64()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of 64
        // [THEN] the reserved box stays 20x10
        X126_VerifyThumbnailSize(20, 10, 64, 20, 10, '20x10 with a maximum of 64');
    end;

    [Test]
    procedure X126_ReservesABoxFor20x10AtMaximum20()
    begin
        // [WHEN] reserving a box for a 20x10 original with a maximum of exactly 20
        // [THEN] the reserved box stays 20x10
        X126_VerifyThumbnailSize(20, 10, 20, 20, 10, '20x10 with a maximum of exactly 20');
    end;

    [Test]
    procedure X126_ReservesABoxFor100x2AtMaximum10()
    begin
        // [WHEN] reserving a box for a 100x2 original with a maximum of 10
        // [THEN] the reserved box is 10x1 - not an error and not 10x0
        X126_VerifyThumbnailSize(100, 2, 10, 10, 1, '100x2 with a maximum of 10');
    end;

    [Test]
    procedure X126_ReservesABoxFor100x10AtMaximum10()
    begin
        // [WHEN] reserving a box for a 100x10 original with a maximum of 10
        // [THEN] the reserved box is 10x1
        X126_VerifyThumbnailSize(100, 10, 10, 10, 1, '100x10 with a maximum of 10');
    end;

    // Hidden generalization check for the 100-wide fixture family: the
    // description confirms the outcome at a handful of maximums only. The
    // expected height is derived independently of the codeunit under test
    // (integer half-up rounding of 63 * MaxDimension / 100), not by calling
    // the same Round the fix would call, so a fix built on a different
    // rounding convention that happened to coincide at the disclosed points
    // would still be caught here. AL stops at the first failing assertion,
    // so a failing run discloses exactly one maximum, not the whole range.
    [Test]
    procedure X126_ReservesBoxesFor100x63AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedHeight := (2 * 63 * MaxDimension + 100) div (2 * 100);

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(100, 63, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(MaxDimension, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 100x63 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 100x63 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Mirrors the sweep above with height as the longer side, so a fix that
    // only generalizes for one orientation still gets caught.
    [Test]
    procedure X126_ReservesBoxesFor63x100AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedWidth: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedWidth := (2 * 63 * MaxDimension + 100) div (2 * 100);

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(63, 100, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 63x100 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(MaxDimension, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 63x100 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Hidden generalization check for the smallest-shorter-side family: an
    // original only 2 pixels tall, swept across every maximum. Grades the
    // 1-pixel-floor rule across its whole region (maximums where the
    // proportional math alone would round to 0) and past its exit boundary
    // (maximums past 74, where the reserved height genuinely becomes 2 and
    // the floor no longer applies).
    [Test]
    procedure X126_ReservesBoxesFor100x2AtEveryMaximumUpToNinetyNine()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 99 do begin
            ExpectedHeight := (2 * 2 * MaxDimension + 100) div (2 * 100);
            if ExpectedHeight < 1 then
                ExpectedHeight := 1;

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(100, 2, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(MaxDimension, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 100x2 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 100x2 original with a maximum of %1', MaxDimension));
        end;
    end;

    // Hidden generalization check for the already-fits family: a 20x10
    // original swept across every maximum up to 40. Grades the never-enlarge
    // rule across its whole region (maximums >= 20, where the box must stay
    // 20x10) instead of at the two disclosed points, and folds in the
    // maximum-just-below-the-longer-side boundary without naming it.
    [Test]
    procedure X126_ReservesBoxesFor20x10AtEveryMaximumUpToForty()
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
        ExpectedWidth: Integer;
        ExpectedHeight: Integer;
        MaxDimension: Integer;
    begin
        for MaxDimension := 1 to 40 do begin
            if MaxDimension >= 20 then begin
                ExpectedWidth := 20;
                ExpectedHeight := 10;
            end else begin
                ExpectedWidth := MaxDimension;
                ExpectedHeight := (2 * 10 * MaxDimension + 20) div (2 * 20);
            end;

            ThumbnailWidth := -7;
            ThumbnailHeight := -9;
            ThumbnailSizer.CalculateThumbnailSize(20, 10, MaxDimension, ThumbnailWidth, ThumbnailHeight);
            Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
                StrSubstNo('Expected the reserved box width for a 20x10 original with a maximum of %1', MaxDimension));
            Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
                StrSubstNo('Expected the reserved box height for a 20x10 original with a maximum of %1', MaxDimension));
        end;
    end;

    local procedure X126_VerifyThumbnailSize(OriginalWidth: Integer; OriginalHeight: Integer; MaxDimension: Integer; ExpectedWidth: Integer; ExpectedHeight: Integer; SourceDescription: Text)
    var
        ThumbnailSizer: Codeunit "CG X126 Thumbnail Sizer";
        ThumbnailWidth: Integer;
        ThumbnailHeight: Integer;
    begin
        ThumbnailWidth := -7;
        ThumbnailHeight := -9;
        ThumbnailSizer.CalculateThumbnailSize(OriginalWidth, OriginalHeight, MaxDimension, ThumbnailWidth, ThumbnailHeight);
        Assert.AreEqual(ExpectedWidth, ThumbnailWidth,
            StrSubstNo('Expected the reserved box width for a %1 original', SourceDescription));
        Assert.AreEqual(ExpectedHeight, ThumbnailHeight,
            StrSubstNo('Expected the reserved box height for a %1 original', SourceDescription));
    end;

    // ==========================================================
    // X127 - donor CG-AL-X127
    // ==========================================================

    local procedure X127_GetOtherCompanyName(): Text[30]
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

    local procedure X127_ClearHere()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
    begin
        SiteSetup.DeleteAll();
        JobCard.DeleteAll();
    end;

    local procedure X127_ClearThere(OtherName: Text[30])
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.DeleteAll();
    end;

    local procedure X127_SeedHere(SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure X127_SeedThere(OtherName: Text[30]; SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure X127_ReadThere(OtherName: Text[30]; SiteCode: Code[10]; var Found: Boolean; var Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        Found := SiteSetup.Get(SiteCode);
        if Found then
            Restricted := SiteSetup.Restricted;
    end;

    local procedure X127_CountThere(OtherName: Text[30]): Integer
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        exit(SiteSetup.Count());
    end;

    [Test]
    procedure X127_SiteCodeWithNoRestrictionRecordedForThisCompanyValidates()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        SiteCodeAfter: Code[10];
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT1', false);
        X127_SeedThere(OtherName, 'DEPOT1', true);

        JobCard.Init();
        JobCard."No." := 'JC001';
        JobCard.Validate("Site Code", 'DEPOT1');
        JobCard.Insert();

        SiteCodeAfter := JobCard."Site Code";

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.AreEqual('DEPOT1', SiteCodeAfter,
            'Expected a site code to validate when no restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure X127_SiteCodeWithARestrictionRecordedForThisCompanyIsRefused()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        ErrorTextAfter: Text;
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT2', true);
        X127_SeedThere(OtherName, 'DEPOT2', false);

        JobCard.Init();
        JobCard."No." := 'JC002';

        asserterror JobCard.Validate("Site Code", 'DEPOT2');
        ErrorTextAfter := GetLastErrorText();

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.IsTrue(StrPos(ErrorTextAfter, 'currently restricted') > 0,
            'Expected the site code to be refused when the restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure X127_SiteCodeWithNoRestrictionOnRecordValidates()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        X127_ClearHere();

        X127_SeedHere('DEPOT3', false);

        JobCard.Init();
        JobCard."No." := 'JC003';
        JobCard.Validate("Site Code", 'DEPOT3');
        JobCard.Insert();

        Assert.AreEqual('DEPOT3', JobCard."Site Code",
            'Expected a site code with no restriction on record to validate.');

        X127_ClearHere();
    end;

    [Test]
    procedure X127_ARestrictionOnOneSiteCodeDoesNotAffectAnother()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        X127_ClearHere();

        X127_SeedHere('DEPOT4', true);
        X127_SeedHere('DEPOT5', false);

        JobCard.Init();
        JobCard."No." := 'JC004';
        JobCard.Validate("Site Code", 'DEPOT5');
        JobCard.Insert();

        Assert.AreEqual('DEPOT5', JobCard."Site Code",
            'Expected a different, unrestricted site code to validate regardless of another site code''s own restriction.');

        X127_ClearHere();
    end;

    [Test]
    procedure X127_ValidatingASiteCodeDoesNotChangeDataInAnotherCompany()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        RowCountAfter: Integer;
        FoundAfter: Boolean;
        RestrictedAfter: Boolean;
        RestrictedHereAfter: Boolean;
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT7', true);
        X127_SeedThere(OtherName, 'DEPOT6', false);

        JobCard.Init();
        JobCard."No." := 'JC005';
        JobCard.Validate("Site Code", 'DEPOT6');
        JobCard.Insert();

        RowCountAfter := X127_CountThere(OtherName);
        X127_ReadThere(OtherName, 'DEPOT6', FoundAfter, RestrictedAfter);
        SiteSetup.Get('DEPOT7');
        RestrictedHereAfter := SiteSetup.Restricted;

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.AreEqual(1, RowCountAfter,
            'Expected validating a job card not to add or remove records belonging to a different company.');
        Assert.IsTrue(FoundAfter,
            'Expected validating a job card not to remove a record belonging to a different company.');
        Assert.IsFalse(RestrictedAfter,
            'Expected validating a job card not to change data belonging to a different company.');
        Assert.IsTrue(RestrictedHereAfter,
            'Expected validating a job card not to change unrelated data recorded for this company.');
    end;

    // ==========================================================
    // X150 - donor CG-AL-X150
    // ==========================================================

    local procedure X150_ClearAllData()
    var
        Team: Record "CG X150 Team";
        Department: Record "CG X150 Department";
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        Team.DeleteAll();
        Department.DeleteAll();
        BudgetHeader.DeleteAll();
    end;

    local procedure X150_SeedBudget(BudgetNo: Code[20]; TotalAmount: Decimal)
    var
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        BudgetHeader.Init();
        BudgetHeader."No." := BudgetNo;
        BudgetHeader."Budget Description" := 'Test budget';
        BudgetHeader."Total Amount" := TotalAmount;
        BudgetHeader.Insert();
    end;

    local procedure X150_SeedDepartment(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal)
    var
        Department: Record "CG X150 Department";
    begin
        Department.Init();
        Department."Budget No." := BudgetNo;
        Department."Line No." := LineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DeptWeight;
        Department.Insert();
    end;

    local procedure X150_SeedDepartmentWithSentinel(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal; SentinelAmount: Decimal)
    var
        Department: Record "CG X150 Department";
    begin
        Department.Init();
        Department."Budget No." := BudgetNo;
        Department."Line No." := LineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DeptWeight;
        Department."Department Amount" := SentinelAmount;
        Department.Insert();
    end;

    local procedure X150_SeedTeam(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal)
    var
        Team: Record "CG X150 Team";
    begin
        Team.Init();
        Team."Budget No." := BudgetNo;
        Team."Department Line No." := DepartmentLineNo;
        Team."Team Line No." := TeamLineNo;
        Team."Team Name" := TeamName;
        Team.Weight := TeamWeight;
        Team.Insert();
    end;

    local procedure X150_SeedTeamWithSentinel(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal; SentinelAmount: Decimal)
    var
        Team: Record "CG X150 Team";
    begin
        Team.Init();
        Team."Budget No." := BudgetNo;
        Team."Department Line No." := DepartmentLineNo;
        Team."Team Line No." := TeamLineNo;
        Team."Team Name" := TeamName;
        Team.Weight := TeamWeight;
        Team."Team Amount" := SentinelAmount;
        Team.Insert();
    end;

    local procedure X150_GetDeptAmount(BudgetNo: Code[20]; LineNo: Integer): Decimal
    var
        Department: Record "CG X150 Department";
    begin
        Department.Get(BudgetNo, LineNo);
        exit(Department."Department Amount");
    end;

    local procedure X150_GetTeamAmount(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer): Decimal
    var
        Team: Record "CG X150 Team";
    begin
        Team.Get(BudgetNo, DepartmentLineNo, TeamLineNo);
        exit(Team."Team Amount");
    end;

    // Independently reconstructs the allocation every correct
    // implementation must produce at ONE level: floor everyone's exact
    // proportional share to the cent, then hand out whatever the floors
    // left on the table one cent at a time to whichever entity's exact
    // entitlement was rounded down by the most, tie-broken by the lower
    // array index. A zero-weight entity's remainder is always exactly
    // zero, so it never competes for a leftover cent. Called once for a
    // budget's departments and once per department for its teams - this
    // mirrors the allocator's own fix, it is the definition of "correct"
    // this oracle grades against, not a re-implementation that happens to
    // agree with one particular solution.
    local procedure X150_ComputeLevelShares(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
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
    procedure X150_SingleDepartmentSingleTeamGetsTheEntireBudget()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('SP01', 246.80);
        X150_SeedDepartment('SP01', 1, 'Solo Department', 4);
        X150_SeedTeam('SP01', 1, 1, 'Solo Team', 17);

        Allocator.AllocateBudget('SP01');

        Assert.AreEqual(246.80, X150_GetDeptAmount('SP01', 1), 'Expected a budget with a single department to allocate its entire total to that department');
        Assert.AreEqual(246.80, X150_GetTeamAmount('SP01', 1, 1), 'Expected a department with a single team to allocate its entire amount to that team');
    end;

    [Test]
    procedure X150_CleanTwoDepartmentTwoTeamSplitReconcilesExactlyAndLeavesAnotherBudgetUntouched()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('CD01', 200.00);
        X150_SeedDepartment('CD01', 1, 'Dept East', 1);
        X150_SeedDepartment('CD01', 2, 'Dept West', 1);
        X150_SeedTeam('CD01', 1, 1, 'Team A', 1);
        X150_SeedTeam('CD01', 1, 2, 'Team B', 1);
        X150_SeedTeam('CD01', 2, 1, 'Team C', 1);
        X150_SeedTeam('CD01', 2, 2, 'Team D', 1);

        // A second, unrelated budget is seeded with its own nonzero
        // sentinel amounts, at every level, and left alone - allocating
        // CD01 must not touch it.
        X150_SeedBudget('XB01', 999.00);
        X150_SeedDepartmentWithSentinel('XB01', 1, 'Dept Untouched', 1, 555.55);
        X150_SeedTeamWithSentinel('XB01', 1, 1, 'Team Untouched A', 1, 111.11);
        X150_SeedTeamWithSentinel('XB01', 1, 2, 'Team Untouched B', 1, 222.22);

        Allocator.AllocateBudget('CD01');

        Assert.AreEqual(100.00, X150_GetDeptAmount('CD01', 1), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(100.00, X150_GetDeptAmount('CD01', 2), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 1, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 1, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 2, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 2, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the budget-level reconciliation total to equal the budget total after allocating');
        Assert.AreEqual(100.00, Allocator.GetDepartmentAllocatedTotal('CD01', 1), 'Expected the department-level reconciliation total to equal the department amount after allocating');

        BudgetHeader.Get('XB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected an untouched budget to stay unallocated');
        Assert.AreEqual(555.55, X150_GetDeptAmount('XB01', 1), 'Expected another budget''s department amount to be left untouched by allocating a different budget');
        Assert.AreEqual(111.11, X150_GetTeamAmount('XB01', 1, 1), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
        Assert.AreEqual(222.22, X150_GetTeamAmount('XB01', 1, 2), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
        // XB01's own teams (333.33) do not reconcile with its own department
        // amount (555.55) or its department with the budget total (999.00)
        // by design - it was never allocated. Pinning the reconciliation
        // totals against the lines' own recorded amounts here, not the
        // header or department fields, catches a reconciliation procedure
        // that just echoes another field instead of reading the table it
        // is supposed to.
        Assert.AreEqual(555.55, Allocator.GetAllocatedTotal('XB01'), 'Expected the budget-level reconciliation total to reflect the budget''s own recorded department amounts');
        Assert.AreEqual(333.33, Allocator.GetDepartmentAllocatedTotal('XB01', 1), 'Expected the department-level reconciliation total to reflect the department''s own recorded team amounts');
    end;

    [Test]
    procedure X150_AdversarialFourDepartmentAllocationClosesExactlyAtEveryLevel()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
        DeptTeamTotal: Decimal;
        GrandTotal: Decimal;
        i: Integer;
    begin
        // Weights chosen so every department's and every team's exact
        // share has a distinct rounding remainder within its own
        // competition (no ties), so this fixture pins outcomes that do
        // not depend on any particular tie-break policy.
        X150_ClearAllData();
        X150_SeedBudget('AD01', 500.00);
        X150_SeedDepartment('AD01', 1, 'Dept Alpha', 26);
        X150_SeedDepartment('AD01', 2, 'Dept Beta', 21);
        X150_SeedDepartment('AD01', 3, 'Dept Gamma', 30);
        X150_SeedDepartment('AD01', 4, 'Dept Delta', 19);

        X150_SeedTeam('AD01', 1, 1, 'Team Alpha-1', 8);
        X150_SeedTeam('AD01', 1, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('AD01', 1, 3, 'Team Alpha-3', 4);

        X150_SeedTeam('AD01', 2, 1, 'Team Beta-1', 1);
        X150_SeedTeam('AD01', 2, 2, 'Team Beta-2', 10);

        X150_SeedTeam('AD01', 3, 1, 'Team Gamma-1', 2);
        X150_SeedTeam('AD01', 3, 2, 'Team Gamma-2', 6);
        X150_SeedTeam('AD01', 3, 3, 'Team Gamma-3', 3);

        X150_SeedTeam('AD01', 4, 1, 'Team Delta-1', 10);
        X150_SeedTeam('AD01', 4, 2, 'Team Delta-2', 9);
        X150_SeedTeam('AD01', 4, 3, 'Team Delta-3', 11);

        Allocator.AllocateBudget('AD01');

        Assert.AreEqual(135.42, X150_GetDeptAmount('AD01', 1), 'Expected Dept Alpha''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(109.37, X150_GetDeptAmount('AD01', 2), 'Expected Dept Beta''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(156.25, X150_GetDeptAmount('AD01', 3), 'Expected Dept Gamma''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(98.96, X150_GetDeptAmount('AD01', 4), 'Expected Dept Delta''s recorded amount to depend only on the budget''s weights and total');

        Assert.AreEqual(63.73, X150_GetTeamAmount('AD01', 1, 1), 'Expected Team Alpha-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(39.83, X150_GetTeamAmount('AD01', 1, 2), 'Expected Team Alpha-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(31.86, X150_GetTeamAmount('AD01', 1, 3), 'Expected Team Alpha-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(9.94, X150_GetTeamAmount('AD01', 2, 1), 'Expected Team Beta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(99.43, X150_GetTeamAmount('AD01', 2, 2), 'Expected Team Beta-2''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(28.41, X150_GetTeamAmount('AD01', 3, 1), 'Expected Team Gamma-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(85.23, X150_GetTeamAmount('AD01', 3, 2), 'Expected Team Gamma-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(42.61, X150_GetTeamAmount('AD01', 3, 3), 'Expected Team Gamma-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(32.99, X150_GetTeamAmount('AD01', 4, 1), 'Expected Team Delta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(29.69, X150_GetTeamAmount('AD01', 4, 2), 'Expected Team Delta-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(36.28, X150_GetTeamAmount('AD01', 4, 3), 'Expected Team Delta-3''s recorded amount to depend only on its department''s amount and weights');

        GrandTotal := 0;
        for i := 1 to 4 do begin
            DeptTeamTotal := X150_GetTeamAmount('AD01', i, 1) + X150_GetTeamAmount('AD01', i, 2);
            // Every department has three teams except Dept Beta (i = 2),
            // which has only two.
            if i <> 2 then
                DeptTeamTotal += X150_GetTeamAmount('AD01', i, 3);
            Assert.AreEqual(
              X150_GetDeptAmount('AD01', i), DeptTeamTotal,
              StrSubstNo('Expected department %1''s teams to sum to exactly that department''s own recorded amount', i));
            GrandTotal += X150_GetDeptAmount('AD01', i);
        end;
        Assert.AreEqual(500.00, GrandTotal, 'Expected every department''s recorded amount to sum to exactly the budget''s total amount');
    end;

    [Test]
    procedure X150_ZeroWeightDepartmentAndZeroWeightTeamAlwaysReceiveExactlyZero()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('ZW01', 90.00);
        X150_SeedDepartment('ZW01', 1, 'Dept Live', 5);
        X150_SeedDepartment('ZW01', 2, 'Dept Sample', 0);
        X150_SeedTeam('ZW01', 1, 1, 'Team Regular', 3);
        X150_SeedTeam('ZW01', 1, 2, 'Team Comp', 0);
        X150_SeedTeam('ZW01', 2, 1, 'Team No Budget', 7);

        Allocator.AllocateBudget('ZW01');

        Assert.AreEqual(90.00, X150_GetDeptAmount('ZW01', 1), 'Expected a department with weight to receive its full proportional share when the only other department has none');
        Assert.AreEqual(0.00, X150_GetDeptAmount('ZW01', 2), 'Expected a department with no weight to receive exactly zero, even though another department on the same budget carries a nonzero total');
        Assert.AreEqual(90.00, X150_GetTeamAmount('ZW01', 1, 1), 'Expected a team with weight to receive its full proportional share when the only other team on its department has none');
        Assert.AreEqual(0.00, X150_GetTeamAmount('ZW01', 1, 2), 'Expected a team with no weight to receive exactly zero, even though another team on the same department carries a nonzero amount');
        Assert.AreEqual(0.00, X150_GetTeamAmount('ZW01', 2, 1), 'Expected a team under a department that itself received zero to receive exactly zero, regardless of the team''s own weight');
    end;

    [Test]
    procedure X150_DepartmentWithNoTeamWeightLeavesItsTeamsUntouched()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('NT01', 80.00);
        X150_SeedDepartment('NT01', 1, 'Dept Funded', 1);
        X150_SeedDepartment('NT01', 2, 'Dept Empty', 1);
        X150_SeedTeam('NT01', 1, 1, 'Team Live', 1);
        X150_SeedTeamWithSentinel('NT01', 2, 1, 'Team Idle 1', 0, 77.77);
        X150_SeedTeamWithSentinel('NT01', 2, 2, 'Team Idle 2', 0, 88.88);

        Allocator.AllocateBudget('NT01');

        Assert.AreEqual(40.00, X150_GetDeptAmount('NT01', 1), 'Expected a funded department to receive its proportional share of the total');
        Assert.AreEqual(40.00, X150_GetDeptAmount('NT01', 2), 'Expected a department with weight to receive its proportional share of the total even when its own teams have none');
        Assert.AreEqual(40.00, X150_GetTeamAmount('NT01', 1, 1), 'Expected the only team on a funded department to receive that department''s entire amount');

        Assert.AreEqual(
          77.77, X150_GetTeamAmount('NT01', 2, 1),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
        Assert.AreEqual(
          88.88, X150_GetTeamAmount('NT01', 2, 2),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
    end;

    [Test]
    procedure X150_WholeBudgetWithNoWeightAnywhereIsLeftUnallocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('NB01', 60.00);
        X150_SeedDepartmentWithSentinel('NB01', 1, 'Dept Idle A', 0, 11.11);
        X150_SeedTeamWithSentinel('NB01', 1, 1, 'Team Idle A1', 0, 22.22);
        X150_SeedDepartmentWithSentinel('NB01', 2, 'Dept Idle B', 0, 33.33);
        X150_SeedTeamWithSentinel('NB01', 2, 1, 'Team Idle B1', 0, 44.44);

        Allocator.AllocateBudget('NB01');

        BudgetHeader.Get('NB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected a budget with no weight on any department to be left unallocated');
        Assert.AreEqual(11.11, X150_GetDeptAmount('NB01', 1), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(33.33, X150_GetDeptAmount('NB01', 2), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(22.22, X150_GetTeamAmount('NB01', 1, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(44.44, X150_GetTeamAmount('NB01', 2, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
    end;

    [Test]
    procedure X150_ReorderingDepartmentsAndTeamsNeverChangesTheirAmount()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        // Same four department weights and the same three team weights
        // under "Alpha" as the adversarial fixture above, entered in the
        // opposite order on the second budget - both at the department
        // level and, within Alpha, at the team level.
        X150_ClearAllData();

        X150_SeedBudget('PM01', 500.00);
        X150_SeedDepartment('PM01', 1, 'Dept Alpha', 26);
        X150_SeedDepartment('PM01', 2, 'Dept Beta', 21);
        X150_SeedDepartment('PM01', 3, 'Dept Gamma', 30);
        X150_SeedDepartment('PM01', 4, 'Dept Delta', 19);
        X150_SeedTeam('PM01', 1, 1, 'Team Alpha-1', 8);
        X150_SeedTeam('PM01', 1, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('PM01', 1, 3, 'Team Alpha-3', 4);

        X150_SeedBudget('PM02', 500.00);
        X150_SeedDepartment('PM02', 1, 'Dept Delta', 19);
        X150_SeedDepartment('PM02', 2, 'Dept Gamma', 30);
        X150_SeedDepartment('PM02', 3, 'Dept Beta', 21);
        X150_SeedDepartment('PM02', 4, 'Dept Alpha', 26);
        X150_SeedTeam('PM02', 4, 1, 'Team Alpha-3', 4);
        X150_SeedTeam('PM02', 4, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('PM02', 4, 3, 'Team Alpha-1', 8);

        Allocator.AllocateBudget('PM01');
        Allocator.AllocateBudget('PM02');

        Assert.AreEqual(135.42, X150_GetDeptAmount('PM01', 1), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(135.42, X150_GetDeptAmount('PM02', 4), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, X150_GetDeptAmount('PM01', 2), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, X150_GetDeptAmount('PM02', 3), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, X150_GetDeptAmount('PM01', 3), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, X150_GetDeptAmount('PM02', 2), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, X150_GetDeptAmount('PM01', 4), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, X150_GetDeptAmount('PM02', 1), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');

        Assert.AreEqual(63.73, X150_GetTeamAmount('PM01', 1, 1), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(63.73, X150_GetTeamAmount('PM02', 4, 3), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, X150_GetTeamAmount('PM01', 1, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, X150_GetTeamAmount('PM02', 4, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, X150_GetTeamAmount('PM01', 1, 3), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, X150_GetTeamAmount('PM02', 4, 1), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
    end;

    [Test]
    procedure X150_SuccessfulAllocationMarksTheBudgetAllocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('MK01', 10.00);
        X150_SeedDepartment('MK01', 1, 'Dept Only', 1);
        X150_SeedTeam('MK01', 1, 1, 'Team Only', 1);

        Allocator.AllocateBudget('MK01');

        BudgetHeader.Get('MK01');
        Assert.IsTrue(BudgetHeader.Allocated, 'Expected a budget with at least one weighted department to be marked allocated');
    end;

    [Test]
    procedure X150_DeterministicSweepMatchesTheTwoLevelReferenceAcrossManyPartitions()
    var
        Department: Record "CG X150 Department";
        Team: Record "CG X150 Team";
        Allocator: Codeunit "CG X150 Budget Allocator";
        Any: Codeunit Any;
        DeptWeight: array[10] of Decimal;
        ExpectedDeptShare: array[10] of Decimal;
        TeamWeightRow: array[10] of Decimal;
        TeamShareRow: array[10] of Decimal;
        ExpectedTeamShare: array[10, 10] of Decimal;
        TeamCount: array[10] of Integer;
        BudgetNo: Code[20];
        TotalAmount: Decimal;
        DeptTeamSum: Decimal;
        GrandSum: Decimal;
        DeptCount: Integer;
        Partition: Integer;
        i: Integer;
        j: Integer;
    begin
        Any.SetSeed(150);

        for Partition := 1 to 6 do begin
            X150_ClearAllData();
            BudgetNo := 'SW' + Format(Partition);
            DeptCount := Any.IntegerInRange(3, 6);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X150_SeedBudget(BudgetNo, TotalAmount);

            for i := 1 to DeptCount do begin
                // Roughly every fourth department on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    DeptWeight[i] := 0
                else
                    DeptWeight[i] := Any.DecimalInRange(1, 500, 3);
                X150_SeedDepartment(BudgetNo, i, StrSubstNo('Sweep dept %1', i), DeptWeight[i]);
            end;

            X150_ComputeLevelShares(DeptWeight, DeptCount, TotalAmount, ExpectedDeptShare);

            for i := 1 to DeptCount do begin
                TeamCount[i] := Any.IntegerInRange(2, 5);
                for j := 1 to TeamCount[i] do begin
                    if j mod 3 = 0 then
                        TeamWeightRow[j] := 0
                    else
                        TeamWeightRow[j] := Any.DecimalInRange(1, 300, 3);
                    X150_SeedTeam(BudgetNo, i, j, StrSubstNo('Sweep dept %1 team %2', i, j), TeamWeightRow[j]);
                end;
                X150_ComputeLevelShares(TeamWeightRow, TeamCount[i], ExpectedDeptShare[i], TeamShareRow);
                for j := 1 to TeamCount[i] do
                    ExpectedTeamShare[i, j] := TeamShareRow[j];
            end;

            Allocator.AllocateBudget(BudgetNo);

            GrandSum := 0;
            for i := 1 to DeptCount do begin
                Department.Get(BudgetNo, i);
                Assert.AreEqual(
                  ExpectedDeptShare[i], Department."Department Amount",
                  StrSubstNo('Expected department %1 of sweep partition %2 to depend only on that budget''s own weights and total', i, Partition));

                DeptTeamSum := 0;
                for j := 1 to TeamCount[i] do begin
                    Team.Get(BudgetNo, i, j);
                    Assert.AreEqual(
                      ExpectedTeamShare[i, j], Team."Team Amount",
                      StrSubstNo('Expected team %1 of department %2 of sweep partition %3 to depend only on its department''s amount and weights', j, i, Partition));
                    DeptTeamSum += Team."Team Amount";
                end;
                Assert.AreEqual(
                  Department."Department Amount", DeptTeamSum,
                  StrSubstNo('Expected the teams under department %1 of sweep partition %2 to sum to exactly that department''s own recorded amount', i, Partition));

                GrandSum += Department."Department Amount";
            end;
            Assert.AreEqual(
              TotalAmount, GrandSum,
              StrSubstNo('Expected every department''s recorded amount on sweep partition %1 to sum to exactly the budget''s total amount', Partition));
        end;
    end;
}
