codeunit 89496 "CG-AL-X274 Test"
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
        // before seeding its own contracts. Contract numbers are unique per
        // test regardless, but the tables are still cleared up front per the
        // house convention.
        // before seeding its own rows.
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
    // X103 - donor CG-AL-X103
    // ==========================================================

    local procedure X103_SeedSubmission(No: Code[20]; ContactEmail: Text[80]; NotifyEmail: Text[80]; SetupCode: Code[10]): Record "CG X103 Submission"
    var
        Submission: Record "CG X103 Submission";
    begin
        Submission.Init();
        Submission."No." := No;
        Submission."Contact E-Mail" := ContactEmail;
        Submission."Notify E-Mail" := NotifyEmail;
        Submission."Setup Code" := SetupCode;
        Submission.Insert();
        exit(Submission);
    end;

    local procedure X103_SeedSetup(SetupCode: Code[10]; FallbackEmail: Text[80])
    var
        NotifySetup: Record "CG X103 Notify Setup";
    begin
        NotifySetup.Init();
        NotifySetup.Code := SetupCode;
        NotifySetup."Fallback E-Mail" := FallbackEmail;
        NotifySetup.Insert();
    end;

    local procedure X103_ClearAllData()
    var
        Submission: Record "CG X103 Submission";
        NotifySetup: Record "CG X103 Notify Setup";
    begin
        Submission.DeleteAll();
        NotifySetup.DeleteAll();
    end;

    [Test]
    procedure X103_BlankContactEmailStillSubmitsWhenNotifyEmailIsSet()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        Submission := X103_SeedSubmission('SUB001', '', 'notify1@example.com', '');

        Submitter.Guard(Submission);

        Assert.AreEqual('notify1@example.com', Submitter.BuildPayload(Submission),
            'Expected a submission with a usable notification e-mail to build that e-mail as its payload');
    end;

    [Test]
    procedure X103_NonBlankContactEmailWithNoUsableEmailIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        Submission := X103_SeedSubmission('SUB002', 'someone@example.com', '', 'NOSETUP');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure X103_BlankContactEmailAndNoUsableEmailIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        Submission := X103_SeedSubmission('SUB003', '', '', '');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure X103_FullChainPrefersNotifyEmailOverFallback()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        X103_SeedSetup('SETUPX', 'fallbackx@example.com');
        Submission := X103_SeedSubmission('SUB004', 'contact4@example.com', 'notify4@example.com', 'SETUPX');

        Submitter.Guard(Submission);

        Assert.AreEqual('notify4@example.com', Submitter.BuildPayload(Submission),
            'Expected the submission''s own notification e-mail to win over the setup fallback when both are present');
    end;

    [Test]
    procedure X103_FullChainFallsBackToSetupWhenNotifyEmailIsBlank()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        X103_SeedSetup('SETUPY', 'fallbacky@example.com');
        Submission := X103_SeedSubmission('SUB005', 'contact5@example.com', '', 'SETUPY');

        Submitter.Guard(Submission);

        Assert.AreEqual('fallbacky@example.com', Submitter.BuildPayload(Submission),
            'Expected the setup fallback e-mail to be used when the submission has no notification e-mail of its own');
    end;

    [Test]
    procedure X103_LinkedSetupWithBlankFallbackIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        X103_SeedSetup('SETUPZ', '');
        Submission := X103_SeedSubmission('SUB007', 'contact7@example.com', '', 'SETUPZ');

        Assert.AreEqual('', Submitter.BuildPayload(Submission),
            'Expected a submission whose linked setup has no fallback e-mail to derive no usable payload');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure X103_DifferentSubmissionsResolveTheirOwnSetupRecord()
    var
        Submitter: Codeunit "CG X103 Submitter";
        SubmissionA: Record "CG X103 Submission";
        SubmissionB: Record "CG X103 Submission";
    begin
        X103_ClearAllData();

        X103_SeedSetup('SETUPA', 'a@example.com');
        X103_SeedSetup('SETUPB', 'b@example.com');
        SubmissionA := X103_SeedSubmission('SUB006A', 'contactA@example.com', '', 'SETUPA');
        SubmissionB := X103_SeedSubmission('SUB006B', 'contactB@example.com', '', 'SETUPB');

        Assert.AreEqual('a@example.com', Submitter.BuildPayload(SubmissionA),
            'Expected the first submission to resolve the fallback e-mail from its own linked setup, not another submission''s');
        Assert.AreEqual('b@example.com', Submitter.BuildPayload(SubmissionB),
            'Expected the second submission to resolve the fallback e-mail from its own linked setup, not another submission''s');
    end;

    // ==========================================================
    // X121 - donor CG-AL-X121
    // ==========================================================

    local procedure X121_CreateContract(var Header: Record "CG X121 Contract Header"; No: Code[20]; PlanCode: Code[10]; RegionCode: Code[10]; ContactName: Text[50])
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

    local procedure X121_AssertAllLinesHaveAmount(ContractNo: Code[20]; ExpectedAmount: Decimal; Msg: Text)
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
    procedure X121_PlanCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C001', 'BASIC', 'EAST', 'Alice');

        Header.Validate("Plan Code", 'PLUS');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C001');

        X121_AssertAllLinesHaveAmount('C001', 200, 'Billing lines must reflect the new plan after the lines are refreshed');
        Assert.AreEqual(6, Header."Last Line Entry No.", 'Refreshing the billing lines after a plan change must rebuild them, not just adjust their amounts in place');

        Line.SetRange("Contract No.", 'C001');
        Assert.IsTrue(Line.FindSet(), 'The contract must still have billing lines after the plan change');
        Assert.AreEqual(1, Line."Period No.", 'The first billing line must keep its position in the billing schedule after the lines are refreshed');
        Line.FindLast();
        Assert.AreEqual(3, Line."Period No.", 'The third billing line must keep its position in the billing schedule after the lines are refreshed');
    end;

    [Test]
    procedure X121_RegionCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C002', 'BASIC', 'EAST', 'Bob');

        Header.Validate("Region Code", 'WEST');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C002');

        X121_AssertAllLinesHaveAmount('C002', 110, 'Billing lines must reflect the new region after the lines are refreshed');
    end;

    [Test]
    procedure X121_ContactNameChangeDoesNotRebuildLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C003', 'BASIC', 'EAST', 'Carol');

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
    procedure X121_PlanCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(HeaderA, 'C004A', 'BASIC', 'EAST', 'Dave');
        X121_CreateContract(HeaderB, 'C004B', 'PLUS', 'NORTH', 'Erin');

        HeaderA.Validate("Plan Code", 'PREMIUM');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C004B');

        X121_AssertAllLinesHaveAmount('C004A', 300, 'Billing lines for the edited contract must reflect its new plan');
        X121_AssertAllLinesHaveAmount('C004B', 240, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure X121_RegionCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(HeaderA, 'C005A', 'PLUS', 'EAST', 'Frank');
        X121_CreateContract(HeaderB, 'C005B', 'PLUS', 'WEST', 'Grace');

        HeaderA.Validate("Region Code", 'NORTH');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C005B');

        X121_AssertAllLinesHaveAmount('C005A', 240, 'Billing lines for the edited contract must reflect its new region');
        X121_AssertAllLinesHaveAmount('C005B', 220, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure X121_PricingFormulaAppliesAcrossPlanAndRegionCodes()
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

        X121_CreateContract(Header, 'C006', 'PLUS', 'EAST', 'Holly');

        for Index := 1 to RegionCodes.Count() do begin
            Header.Get('C006');
            Header.Validate("Region Code", RegionCodes.Get(Index));
            Header.Modify();
            ContractMgt.RefreshLines(Header);
            X121_AssertAllLinesHaveAmount('C006', 200 * ExpectedRegionFactors.Get(Index), 'Billing lines must reflect the region currently on the header');
        end;

        PlanCodes.Add('GOLD');
        ExpectedPlanRates.Add(100);

        X121_CreateContract(PlanHeader, 'C007', 'BASIC', 'EAST', 'Ivan');

        for Index := 1 to PlanCodes.Count() do begin
            PlanHeader.Get('C007');
            PlanHeader.Validate("Plan Code", PlanCodes.Get(Index));
            PlanHeader.Modify();
            ContractMgt.RefreshLines(PlanHeader);
            X121_AssertAllLinesHaveAmount('C007', ExpectedPlanRates.Get(Index) * 1.0, 'Billing lines must reflect the plan currently on the header');
        end;
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
    // X140 - donor CG-AL-X140
    // ==========================================================

    local procedure X140_ClearAllData()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure X140_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure X140_SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Item Description" := ItemDescription;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine.Insert();
    end;

    local procedure X140_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine."Rebate Amount" := SentinelAmount;
        RebateLine.Insert();
    end;

    local procedure X140_GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Get(DocumentNo, LineNo);
        exit(RebateLine."Rebate Amount");
    end;

    // Independently reconstructs the allocation every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a time
    // to the lines closest to rounding up, tie-broken by the lower line
    // number. A zero-weight line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's own
    // fix - it is the definition of "correct" this oracle grades against,
    // not a re-implementation that happens to agree with one particular
    // solution.
    local procedure X140_ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
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
        for i := 1 to LineCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
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
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X140_SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('SL01', 123.45);
        X140_SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, X140_GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X140_TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('EV01', 10.00);
        X140_SeedLine('EV01', 1, 'Widget A', 1);
        X140_SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        X140_SeedHeader('EV02', 250.00);
        X140_SeedLineWithSentinel('EV02', 1, 1, 111.11);
        X140_SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, X140_GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, X140_GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure X140_AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        X140_ClearAllData();
        X140_SeedHeader('ZL01', 77.77);
        X140_SeedLine('ZL01', 1, 'Item P', 2.3);
        X140_SeedLine('ZL01', 2, 'Item Q', 5.7);
        X140_SeedLine('ZL01', 3, 'Item R', 3.1);
        X140_SeedLine('ZL01', 4, 'Item S', 1.9);
        X140_SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, X140_GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, X140_GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, X140_GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, X140_GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, X140_GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();

        // Document PM01: lines entered P, Q, R, S.
        X140_SeedHeader('PM01', 77.77);
        X140_SeedLine('PM01', 1, 'Item P', 2.3);
        X140_SeedLine('PM01', 2, 'Item Q', 5.7);
        X140_SeedLine('PM01', 3, 'Item R', 3.1);
        X140_SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        X140_SeedHeader('PM02', 77.77);
        X140_SeedLine('PM02', 1, 'Item P', 2.3);
        X140_SeedLine('PM02', 2, 'Item Q', 5.7);
        X140_SeedLine('PM02', 3, 'Item S', 1.9);
        X140_SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, X140_GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, X140_GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(X140_GetLineAmount('PM01', 3), X140_GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(X140_GetLineAmount('PM01', 4), X140_GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('NW01', 50.00);
        X140_SeedLineWithSentinel('NW01', 1, 0, 555.55);
        X140_SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, X140_GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, X140_GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure X140_SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('MK01', 40.00);
        X140_SeedLine('MK01', 1, 'Widget A', 1);
        X140_SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X140_DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        Any: Codeunit Any;
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        DocumentNo: Code[20];
        TotalAmount: Decimal;
        SumOfAmounts: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(140);

        for Partition := 1 to 8 do begin
            X140_ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X140_SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X140_SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            X140_ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], X140_GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += X140_GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
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
