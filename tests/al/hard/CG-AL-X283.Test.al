codeunit 89505 "CG-AL-X283 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 8 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // every test clears its own tables before seeding its own rows.
        // (measured, SOAP runner), so every test clears the table before
        // seeding its own rows.

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
    // X087 - donor CG-AL-X087
    // ==========================================================

    local procedure X087_Reset()
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.DeleteAll();
    end;

    local procedure X087_SeedSource(No: Code[20]; DescriptionValue: Text[100])
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.Init();
        Header."No." := No;
        Header.Description := DescriptionValue;
        Header.Status := Header.Status::Open;
        Header.Insert();
    end;

    [Test]
    procedure X087_CopyingADocumentEndsUpReleasedAndAudited()
    var
        Header: Record "CG X087 Document Header";
        SourceHeader: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        X087_SeedSource('SRC001', 'Original document');

        CopyMgt.CopyDocument('SRC001', 'NEW001');

        Header.Get('NEW001');
        Assert.AreEqual('SRC001', Header."Copied From No.", 'The copy must record which document it came from');
        Assert.AreEqual('Original document', Header.Description, 'The copy must carry over the source description');
        Assert.AreEqual(Header.Status::Released, Header.Status, 'The copy must end up released');
        Assert.AreEqual('REL-NEW001', Header."Release Reference", 'The copy must keep the release reference recorded when it was released');
        Assert.IsTrue(Header."Copy Audited", 'The copy must be marked as audited');

        SourceHeader.Get('SRC001');
        Assert.AreEqual(SourceHeader.Status::Open, SourceHeader.Status, 'The source document must be left untouched');
        Assert.AreEqual('', SourceHeader."Release Reference", 'The source document must not gain a release reference');
        Assert.IsFalse(SourceHeader."Copy Audited", 'The source document must not be marked as audited');
    end;

    [Test]
    procedure X087_AuditingADocumentDirectlyLeavesOtherFieldsUnchanged()
    var
        Header: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Header.Init();
        Header."No." := 'STANDALONE';
        Header.Description := 'Directly entered document';
        Header.Status := Header.Status::Copied;
        Header.Insert();

        CopyMgt.AuditDocument('STANDALONE');

        Header.Get('STANDALONE');
        Assert.IsTrue(Header."Copy Audited", 'A directly audited document must be marked as audited');
        Assert.AreEqual(Header.Status::Copied, Header.Status, 'Auditing a document must not change its status, even one currently showing as copied');
        Assert.AreEqual('', Header."Release Reference", 'Auditing a document directly must not invent a release reference');
    end;

    [Test]
    procedure X087_AuditingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X087 Document Header";
        Other: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Target.Init();
        Target."No." := 'TARGET';
        Target.Description := 'Document to audit';
        Target.Status := Target.Status::Open;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other.Description := 'Unrelated document';
        Other.Status := Other.Status::Released;
        Other."Copy Audited" := true;
        Other."Release Reference" := 'REL-OTHER';
        Other.Insert();

        CopyMgt.AuditDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(Other.Status::Released, Other.Status, 'An unrelated document''s status must not change');
        Assert.IsTrue(Other."Copy Audited", 'An unrelated document''s audited flag must not change');
        Assert.AreEqual('Unrelated document', Other.Description, 'An unrelated document''s description must not change');
        Assert.AreEqual('REL-OTHER', Other."Release Reference", 'An unrelated document''s release reference must not change');
    end;

    // ==========================================================
    // X116 - donor CG-AL-X116
    // ==========================================================

    [Test]
    procedure X116_SingleInvoiceRendersNumberSpaceAmount()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] One applied invoice becomes one entry with two forced decimals
        Composer.AddInvoice('INV-1001', 250);

        Assert.AreEqual('INV-1001 250.00', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number, one space, and the amount with exactly two decimals');
    end;

    [Test]
    procedure X116_EntriesAreJoinedWithCommaAndSpace()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] Two applied invoices are joined by ', ' in the order they were added
        Composer.AddInvoice('INV-1001', 250);
        Composer.AddInvoice('INV-1002', 13.5);

        Assert.AreEqual('INV-1001 250.00, INV-1002 13.50', Composer.GetRemittanceText(),
            'Expected the entries joined by a comma and a single space, in the order added');
    end;

    [Test]
    procedure X116_LargeAmountRendersAsPlainDigits()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A large amount stays plain digits with a dot and two decimals
        Composer.AddInvoice('INV-2001', 1234567.8);

        Assert.AreEqual('INV-2001 1234567.80', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number followed by a space and the amount as plain digits');
    end;

    [Test]
    procedure X116_NoInvoicesYieldEmptyText()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A composer with nothing added produces an empty remittance line
        Assert.AreEqual('', Composer.GetRemittanceText(),
            'Expected an empty text when no invoice was added');
    end;

    [Test]
    procedure X116_ExactlyFullCapacityComesBackUntouched()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNoA: Text;
        InvoiceNoB: Text;
    begin
        // [SCENARIO] A join of exactly 140 characters fits the limit and gets no suffix
        // [GIVEN] two entries of 69 characters each: 69 + 2 + 69 = 140
        InvoiceNoA := PadStr('TRYAL-EXACT-A-', 63, 'X');
        InvoiceNoB := PadStr('TRYAL-EXACT-B-', 63, 'X');
        Composer.AddInvoice(InvoiceNoA, 10.12);
        Composer.AddInvoice(InvoiceNoB, 10.12);

        Assert.AreEqual(InvoiceNoA + ' 10.12, ' + InvoiceNoB + ' 10.12', Composer.GetRemittanceText(),
            'Expected the full join back unchanged: it is exactly 140 characters, so nothing may be left out and no suffix may appear');
    end;

    [Test]
    procedure X116_SingleEntryOfExactlyFullCapacityIsAccepted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNo: Text;
    begin
        // [SCENARIO] A lone entry of exactly 140 characters can still be sent: accepted and returned untouched
        // [GIVEN] an invoice number of 134 characters - the entry is 134 + 1 + 5 = 140
        InvoiceNo := PadStr('TRYAL-FULL-', 134, 'X');
        Composer.AddInvoice(InvoiceNo, 10.12);

        Assert.AreEqual(InvoiceNo + ' 10.12', Composer.GetRemittanceText(),
            'Expected the single 140-character entry back unchanged: 140 is exactly the limit, so it must be accepted and no suffix may appear');
    end;

    [Test]
    procedure X116_OneCharacterOverflowDropsTheLastEntry()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNoA: Text;
        InvoiceNoB: Text;
    begin
        // [SCENARIO] A join of 141 characters overflows: the last entry is replaced by the suffix
        // [GIVEN] entries of 69 and 70 characters: 69 + 2 + 70 = 141, one over the limit
        InvoiceNoA := PadStr('TRYAL-OVER-A-', 63, 'X');
        InvoiceNoB := PadStr('TRYAL-OVER-B-', 64, 'X');
        Composer.AddInvoice(InvoiceNoA, 10.12);
        Composer.AddInvoice(InvoiceNoB, 10.12);

        Assert.AreEqual(InvoiceNoA + ' 10.12, and 1 more', Composer.GetRemittanceText(),
            'Expected the 141-character join to overflow: keep the first entry whole and end with ", and 1 more"');
    end;

    [Test]
    procedure X116_SuffixSpaceForcesARecountOfTheOmitted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] The suffix claims its own space: appending it pushes one more entry out
        // [GIVEN] 13 entries of 12 characters - 10 fit without a suffix (138), but only 9 fit next to it
        for Index := 1 to 13 do
            Composer.AddInvoice(X116_SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 4 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 13 added invoices to keep 9 entries and end with the matching omitted-count suffix');
    end;

    [Test]
    procedure X116_SuffixedTextOfExactly140IsKept()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A suffixed text of exactly 140 characters stays within the limit - no extra entry may be left out
        // [GIVEN] 12 entries of 11 characters: the full join is 154, but 10 entries (128) plus ', and 2 more' (12) land on exactly 140
        for Index := 1 to 12 do
            Composer.AddInvoice(X116_FiveCharInvoiceNo(Index), 10.12);
        for Index := 1 to 10 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_FiveCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 2 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected 10 kept entries and "and 2 more": the suffixed text lands on exactly 140 characters, which still fits the limit');
    end;

    [Test]
    procedure X116_OnlyTheSuffixRemainsWhenNotEvenTheFirstEntryFits()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] When the first entry plus the suffix exceeds 140, the text is the bare suffix
        // [GIVEN] a first entry of 130 characters (130 + ', and 3 more' = 142) and three normal ones
        Composer.AddInvoice(PadStr('TRYAL-SOLO-', 124, 'X'), 10.12);
        Composer.AddInvoice('TRYAL-S2', 10.12);
        Composer.AddInvoice('TRYAL-S3', 10.12);
        Composer.AddInvoice('TRYAL-S4', 10.12);

        Assert.AreEqual('and 4 more', Composer.GetRemittanceText(),
            'Expected just "and 4 more": not even the first entry fits alongside the suffix, so every invoice counts as left out and no leading comma appears');
    end;

    [Test]
    procedure X116_OverlongSingleEntryRaisesAnError()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry longer than 140 characters can never be sent and must be refused
        // [GIVEN] an invoice number of 135 characters - the entry is 135 + 1 + 5 = 141, one over the limit
        asserterror Composer.AddInvoice(PadStr('TRYAL-HUGE-', 135, 'X'), 10.12);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure X116_GeneratedAmountsAreRenderedExactly()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        Any: Codeunit Any;
        AmountA: Decimal;
        AmountB: Decimal;
    begin
        // [SCENARIO] Random amounts survive composition unchanged - hardcoding the examples cannot pass
        Any.SetSeed(116);
        AmountA := Any.DecimalInRange(1000, 999999, 2);
        AmountB := Any.DecimalInRange(1000, 999999, 2);
        Composer.AddInvoice('TRYAL-G1', AmountA);
        Composer.AddInvoice('TRYAL-G2', AmountB);

        Assert.AreEqual('TRYAL-G1 ' + X116_InvariantAmount(AmountA) + ', TRYAL-G2 ' + X116_InvariantAmount(AmountB),
            Composer.GetRemittanceText(),
            StrSubstNo('Expected the amounts %1 and %2 rendered with a dot and exactly two decimals, joined by ", "', AmountA, AmountB));
    end;

    [Test]
    procedure X116_GeneratedInvoiceCountDrivesTheSuffix()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        Any: Codeunit Any;
        ExpectedText: Text;
        Total: Integer;
        Index: Integer;
    begin
        // [SCENARIO] However many 12-character entries are added, 9 fit next to the suffix and N is Total - 9
        Any.SetSeed(116);
        Total := Any.IntegerInRange(13, 40);
        for Index := 1 to Total do
            Composer.AddInvoice(X116_SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += StrSubstNo(', and %1 more', Total - 9);

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            StrSubstNo('Expected the remittance text for %1 added invoices to keep 9 entries and end with the matching omitted-count suffix', Total));
    end;

    [Test]
    procedure X116_LargeInvoiceCountStaysWithinTheLimit()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A much larger batch still ends up within the 140-character limit
        // [GIVEN] 40 entries of 8 characters - 14 fit without a suffix (138), but only 12 fit next to it
        for Index := 1 to 40 do
            Composer.AddInvoice(X116_TwoCharInvoiceNo(Index), 10.12);
        for Index := 1 to 12 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_TwoCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 28 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 40 added invoices to keep 12 entries and end with the matching omitted-count suffix, staying within the 140-character limit');
    end;

    [Test]
    procedure X116_WholeNumberAmountAtFullCapacityIsAccepted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNo: Text;
    begin
        // [SCENARIO] An entry built from a whole-number amount can still land exactly on the 140-character limit
        // [GIVEN] an invoice number of 133 characters - the entry is 133 + 1 + 6 = 140
        InvoiceNo := PadStr('TRYAL-WFULL-A-', 133, 'X');
        Composer.AddInvoice(InvoiceNo, 250);

        Assert.AreEqual(InvoiceNo + ' 250.00', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number followed by a space and 250.00');
    end;

    [Test]
    procedure X116_WholeNumberAmountOneOverCapacityIsRejected()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry built from a whole-number amount is refused once it is one character over the limit
        // [GIVEN] an invoice number of 134 characters - the entry is 134 + 1 + 6 = 141
        asserterror Composer.AddInvoice(PadStr('TRYAL-WFULL-B-', 134, 'X'), 250);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure X116_RejectedInvoiceIsNotRecordedAlongsideEarlierOnes()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An invoice that is refused does not join the invoices already recorded
        Composer.AddInvoice('INV-3001', 250);
        asserterror Composer.AddInvoice(PadStr('TRYAL-REJECT-', 135, 'X'), 10.12);

        Assert.ExpectedError('140');
        Assert.AreEqual('INV-3001 250.00', Composer.GetRemittanceText(),
            'Expected only the earlier invoice in the remittance text');
    end;

    local procedure X116_TwoCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('0' + Format(Index));
        exit(Format(Index));
    end;

    local procedure X116_SixCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV-0' + Format(Index));
        exit('INV-' + Format(Index));
    end;

    local procedure X116_FiveCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV0' + Format(Index));
        exit('INV' + Format(Index));
    end;

    local procedure X116_InvariantAmount(Value: Decimal): Text
    begin
        exit(Format(Value, 0, '<Precision,2:2><Standard Format,9>'));
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
    // X147 - donor CG-AL-X147
    // ==========================================================

    local procedure X147_ClearAll()
    var
        AttrDefault: Record "CG X147 Attribute Default";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        AttrDefault.DeleteAll();
        AssignmentEntry.DeleteAll();
    end;

    local procedure X147_SeedEntityValue(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetEntityValue(EntityType, EntityNo, AttributeCode, NewValue);
    end;

    local procedure X147_SeedTypeValue(EntityType: Enum "CG X147 Entity Type"; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetTypeValue(EntityType, AttributeCode, NewValue);
    end;

    local procedure X147_AssertResolvesTo(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; ExpectedValue: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual(ExpectedValue, Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsTrue(AssignmentEntry.FindFirst(), MessagePrefix + ' - assignment recorded');
        Assert.AreEqual(ExpectedValue, AssignmentEntry."Resolved Value", MessagePrefix + ' - assignment value');
    end;

    local procedure X147_AssertResolvesToNothing(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual('', Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsFalse(AssignmentEntry.FindFirst(), MessagePrefix + ' - no assignment recorded');
    end;

    [Test]
    procedure X147_EntityWithItsOwnValueResolvesToIt()
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD', 'An entity with its own value for an attribute resolves to it');
    end;

    [Test]
    procedure X147_SettingAnEntitysValueAgainLeavesTheNewValueInForce()
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'GOLD');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'SILVER');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'SILVER', 'An entity whose own value is set a second time resolves to the newer value');
    end;

    [Test]
    procedure X147_EntityRelyingOnTheStandardValueForItsTypeResolvesToIt()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST2', 'TIER', 'STANDARD', 'An entity with no value of its own resolves to the standard value set for its type');
    end;

    [Test]
    procedure X147_EntityWithItsOwnValueIsUnaffectedByItsTypesStandardValue()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM', 'An entity with its own value resolves to it even when a standard value exists for its type');
    end;

    [Test]
    procedure X147_EntityWithNeitherItsOwnNorAStandardValueResolvesToNothing()
    begin
        X147_ClearAll();

        X147_AssertResolvesToNothing("CG X147 Entity Type"::Customer, 'CUST4', 'TIER', 'An entity with no value of its own and no standard value for its type resolves to nothing');
    end;

    [Test]
    procedure X147_EntityDoesNotInheritAnotherTypesStandardValue()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');

        X147_AssertResolvesToNothing("CG X147 Entity Type"::Vendor, 'VEND1', 'TIER', 'An entity does not resolve to a standard value set for a different entity type');
    end;

    [Test]
    procedure X147_TwoAttributesOnTheSameTypeResolveIndependently()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-TIER');
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'REGION', 'STANDARD-REGION');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'TIER', 'STANDARD-TIER', 'An entity resolves the standard value for one attribute');
        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'REGION', 'STANDARD-REGION', 'An entity resolves the standard value for a different attribute independently');
    end;

    [Test]
    procedure X147_SeveralEntitiesEachResolveTheirOwnCase()
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER', 'SENT-VAL');
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C');
        X147_SeedTypeValue("CG X147 Entity Type"::Vendor, 'TIER', 'STANDARD-V');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST7', 'TIER', 'STANDARD-C', 'A customer with no value of its own resolves to its type''s standard value');
        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C', 'A customer with its own value resolves to it, not to its type''s standard value');
        X147_AssertResolvesTo("CG X147 Entity Type"::Vendor, 'VEND2', 'TIER', 'STANDARD-V', 'A vendor with no value of its own resolves to its own type''s standard value, not the customer''s');

        Assert.IsTrue(AttrDefault.Get("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER'), 'An unrelated entity''s own value must survive');
        Assert.AreEqual('SENT-VAL', AttrDefault.Value, 'An unrelated entity''s own value must be unchanged');
    end;

    // ==========================================================
    // X152 - donor CG-AL-X152
    // ==========================================================

    [Test]
    procedure X152_ImportingUniqueSettingsSavesEveryEntry()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P1', 'retries=3;timeout=30;endpoint=https://api.example.com');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P1', 'retries'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('30', ConfigImporter.GetSetting('P1', 'timeout'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('https://api.example.com', ConfigImporter.GetSetting('P1', 'endpoint'), 'A plain config with no repeated setting must save every entry.');
    end;

    [Test]
    procedure X152_BlankSegmentsAreSkippedAndAnEmptyValueIsKept()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P2', ';present=set;;flag=;   ;another=data;');

        Setting.SetRange("Profile Code", 'P2');
        Assert.AreEqual(3, Setting.Count(), 'Blank and all-space segments must not produce extra saved settings.');
        Assert.AreEqual('set', ConfigImporter.GetSetting('P2', 'present'), 'A normal entry around blank segments must still save correctly.');
        Assert.IsTrue(ConfigImporter.SettingExists('P2', 'flag'), 'An entry with no value after the equals sign is still a valid setting.');
        Assert.AreEqual('', ConfigImporter.GetSetting('P2', 'flag'), 'An entry with no value after the equals sign must save as an empty value, not be dropped.');
        Assert.AreEqual('data', ConfigImporter.GetSetting('P2', 'another'), 'An entry following blank segments must still save correctly.');
    end;

    [Test]
    procedure X152_ARepeatedSettingAtTheEndOfTheStringKeepsTheLastValue()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P3', 'code=1;code=2;code=3');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P3', 'code'), 'When a setting is listed three times, the last-listed value must be the one that is saved.');
    end;

    [Test]
    procedure X152_ARepeatedSettingKeepsItsOwnLastValueEvenWhenOtherSettingsFollowIt()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P4', 'code=1;code=2;other=9');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P4', 'code'), 'The last-listed value for a repeated setting wins, regardless of where in the string its final occurrence sits relative to other settings.');
        Assert.AreEqual('9', ConfigImporter.GetSetting('P4', 'other'), 'A setting listed after a repeated one must still be saved with its own value.');
    end;

    [Test]
    procedure X152_AnInvalidEntryLeavesThePreviouslySavedSettingsAndSkipsTheRestOfTheFile()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P5', 'keep=100;stable=200');
        Commit();

        asserterror ConfigImporter.ImportConfig('P5', 'keep=999;fresh=555;badline');

        Assert.AreEqual('100', ConfigImporter.GetSetting('P5', 'keep'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.AreEqual('200', ConfigImporter.GetSetting('P5', 'stable'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.IsFalse(ConfigImporter.SettingExists('P5', 'fresh'), 'None of a failed file''s settings may be saved, including ones listed before the point of failure.');
    end;

    [Test]
    procedure X152_ImportingIntoOneProfileLeavesAnotherProfileUntouched()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P6A', 'shared=1');
        ConfigImporter.ImportConfig('P6B', 'shared=99;private=42');

        ConfigImporter.ImportConfig('P6A', 'shared=2;fresh=7');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P6A', 'shared'), 'Re-importing into one profile must update that profile''s own settings.');
        Assert.AreEqual('7', ConfigImporter.GetSetting('P6A', 'fresh'), 'Re-importing into one profile must save new settings for that profile.');
        Assert.AreEqual('99', ConfigImporter.GetSetting('P6B', 'shared'), 'Importing into one profile must not change a same-named setting saved for a different profile.');
        Assert.AreEqual('42', ConfigImporter.GetSetting('P6B', 'private'), 'Importing into one profile must not touch a different profile''s other settings.');
    end;

    [Test]
    procedure X152_GetSettingOnAMissingKeyFails()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P7', 'present=1');

        asserterror ConfigImporter.GetSetting('P7', 'absent');
    end;

    [Test]
    procedure X152_SettingExistsReportsWhetherASettingWasSaved()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P8', 'present=1');

        Assert.IsTrue(ConfigImporter.SettingExists('P8', 'present'), 'A setting that was saved must be reported as existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8', 'absent'), 'A setting that was never saved must be reported as not existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8Other', 'present'), 'A setting saved for one profile must not be reported as existing under a different profile.');
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
}
