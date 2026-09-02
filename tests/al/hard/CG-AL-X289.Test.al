codeunit 89511 "CG-AL-X289 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows. Rows that
        // belong to a different document than the one under test are seeded
        // with a nonzero count/value so "untouched" and "coincidentally zero"
        // stay distinguishable.
        // every test clears the table before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own records.
        // before seeding its own rows.

    // ==========================================================
    // X074 - donor CG-AL-X074
    // ==========================================================

    local procedure X074_SeedComment(ExpenseReportNo: Code[20]; LineNo: Integer; CommentText: Text[250])
    var
        CommentLine: Record "CG X074 Comment Line";
    begin
        CommentLine.Init();
        CommentLine."Expense Report No." := ExpenseReportNo;
        CommentLine."Line No." := LineNo;
        CommentLine."Comment Text" := CommentText;
        CommentLine.Insert();
    end;

    local procedure X074_SeedReport(No: Code[20]; InitialCommentCount: Integer)
    var
        ExpenseReport: Record "CG X074 Report";
    begin
        ExpenseReport.Init();
        ExpenseReport."No." := No;
        ExpenseReport."Total Comment Count" := InitialCommentCount;
        ExpenseReport.Insert();
    end;

    [Test]
    procedure X074_BrandNewReportShowsNoRelatedComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        // Orphaned comment lines left behind by other users' unsaved
        // reports elsewhere in the system - none of these belong to the
        // report being opened.
        X074_SeedComment('', 1, 'orphan one');
        X074_SeedComment('', 2, 'orphan two');
        X074_SeedComment('', 3, 'orphan three');

        // A real, saved report's own comments - also not the one being
        // opened, and must not be counted either.
        X074_SeedComment('R0001', 1, 'unrelated report comment');
        X074_SeedComment('R0001', 2, 'unrelated report comment');

        // A comments list opening for a brand-new, not-yet-saved report has
        // no report key yet.
        CommentLineRec.SetRange("Expense Report No.", '');
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(0, CommentCount, 'A brand-new report has no comments of its own yet');
    end;

    [Test]
    procedure X074_SavedReportCountIncludesOnlyItsOwnComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0002', 1, 'r0002 comment');
        X074_SeedComment('R0002', 2, 'r0002 comment');
        X074_SeedComment('R0003', 1, 'r0003 comment');
        X074_SeedComment('R0003', 2, 'r0003 comment');
        X074_SeedComment('R0003', 3, 'r0003 comment');
        X074_SeedComment('R0003', 4, 'r0003 comment');
        X074_SeedComment('', 1, 'orphan');

        // Positioned on one of the report's own lines - the way a saved
        // report's comments list actually lands once it opens, rather than
        // a range with nothing found yet.
        CommentLineRec.SetRange("Expense Report No.", 'R0002');
        CommentLineRec.FindFirst();
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(2, CommentCount, 'A saved report only counts its own comments');
    end;

    [Test]
    procedure X074_PositionedRecordWithNoActiveRangeUsesItsOwnKey()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0004', 1, 'r0004 comment');
        X074_SeedComment('R0004', 2, 'r0004 comment');
        X074_SeedComment('R0004', 3, 'r0004 comment');
        X074_SeedComment('R0004', 4, 'r0004 comment');
        X074_SeedComment('R0004', 5, 'r0004 comment');
        X074_SeedComment('R0005', 1, 'other report comment');

        // Positioned directly on one of the report's own lines, with no
        // range ever set on the field - the way a row looks once you've
        // simply looked it up, rather than searched for it.
        CommentLineRec.Get('R0004', 1);
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(5, CommentCount, 'A positioned line must report its own report''s comment count');
    end;

    [Test]
    procedure X074_CommentsAreAppendedWithIncreasingLineNumbers()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R0006', 'first note');
        CommentMgt.AddComment('R0006', 'second note');

        CommentLine.Get('R0006', 10000);
        Assert.AreEqual('first note', CommentLine."Comment Text", 'The first comment must be stored at the first line');

        CommentLine.Get('R0006', 20000);
        Assert.AreEqual('second note', CommentLine."Comment Text", 'The second comment must be stored at the next line');
    end;

    [Test]
    procedure X074_ReportSummaryReflectsOnlyItsOwnCommentsAndLeavesOthersAlone()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        OtherExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        X074_SeedReport('R0008', 777);

        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');
        CommentMgt.AddComment('R0007', 'c');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(3, ExpenseReport."Total Comment Count", 'The updated report must show its own current comment count');

        OtherExpenseReport.Get('R0008');
        Assert.AreEqual(777, OtherExpenseReport."Total Comment Count", 'A different report''s stored count must not change');
    end;

    [Test]
    procedure X074_UpdateReportSummaryExcludesAnUnrelatedReportsComments()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');

        X074_SeedComment('R0008', 1, 'unrelated');
        X074_SeedComment('R0008', 2, 'unrelated');
        X074_SeedComment('R0008', 3, 'unrelated');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(2, ExpenseReport."Total Comment Count",
          'A report''s updated comment count must reflect only its own comments, not another report''s');
    end;

    [Test]
    procedure X074_LineNumberingDoesNotLeakAcrossReports()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R9999', 'someone else''s first note');
        CommentMgt.AddComment('R0001', 'first note for a different report');

        CommentLine.Get('R0001', 10000);
        Assert.AreEqual('first note for a different report', CommentLine."Comment Text",
          'A report''s first comment must always start at its own first line, regardless of what other reports already contain');
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
    // X120 - donor CG-AL-X120
    // ==========================================================

    local procedure X120_ClearAllData()
    var
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        Pending.DeleteAll();
        ApprovedRecord.DeleteAll();
    end;

    [Test]
    procedure X120_ChangingATrackedFieldPutsTheRecordOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
        Pending: Record "CG X120 Pending Verification";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to appear on the pending list after a tracked field was changed away from its approved value');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the changed field itself to be flagged pending');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field to be pending after a single field was changed');
        Assert.IsTrue(Pending.Get('ACME', 'Contact Name'),
            'Expected the change to be recorded directly in the pending-verification storage, not just reported through the codeunit');
        ApprovedRecord.Get('ACME');
        Assert.AreEqual('Acme Corporation', ApprovedRecord."Contact Name",
            'Expected the new contact name to be persisted on the record itself');
    end;

    [Test]
    procedure X120_ARecordThatMatchesItsApprovedValuesAgainIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        Pending: Record "CG X120 Pending Verification";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once the changed field matched its approved value again');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending once the only changed field matched its approved value again');
        Pending.SetRange("Record No.", 'ACME');
        Assert.IsTrue(Pending.IsEmpty(),
            'Expected no leftover entry to remain recorded for the record once every tracked field matched again');
    end;

    [Test]
    procedure X120_ACreditLimitThatExactlyMatchesItsApprovedValueIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetCreditLimit('ACME', 999.99);
        ApprovedRecord.Get('ACME');
        Assert.AreEqual(999.99, ApprovedRecord."Credit Limit",
            'Expected the new credit limit to be persisted on the record itself');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value is close to, but not exactly, its approved value');

        Reconciler.SetCreditLimit('ACME', 1000.01);
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value is close to, but not exactly, its approved value');

        Reconciler.SetCreditLimit('ACME', 1000.001);
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to remain pending while its value differs from its approved value by even a small amount');

        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the field to come off the pending list only once it was set back to exactly its approved value');
        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once its only changed field matched its approved value exactly');
    end;

    [Test]
    procedure X120_ARecordWithOneFieldStillDifferingRemainsOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to remain on the pending list while one of its two changed fields still differs from its approved value');
        Assert.IsFalse(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the matched field to no longer be flagged pending on its own');
        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Credit Limit'),
            'Expected the still-changed field to remain flagged pending');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field to remain pending while only one of two changed fields matches its approved value');
    end;

    [Test]
    procedure X120_ARecordWhoseFieldsAllMatchTheirApprovedValuesIsNotOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once every changed field matched its approved value again');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending once both changed fields matched their approved values again');
    end;

    [Test]
    procedure X120_ChangingAFieldAgainToADifferentValueStaysPendingWithoutDuplicating()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Reconciler.SetContactName('ACME', 'Acme Corp Ltd');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected the field to remain pending after being changed a second time to another value that still differs from its approved value');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected changing an already-pending field again to leave exactly one pending entry, not create a second one');
    end;

    [Test]
    procedure X120_AFieldThatDiffersAfterPreviouslyMatchingIsOnThePendingListAgain()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corporation');
        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to be pending right after the field was first changed');

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected the record to come off the pending list once the field matched its approved value again');

        Reconciler.SetContactName('ACME', 'Acme Corp Revised');
        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the record to go back on the pending list once the same field differed from its approved value again');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one pending field after a field differed, matched, and then differed again');
    end;

    [Test]
    procedure X120_ApprovingCurrentValuesSnapshotsThemAsTheNewBaselineAndClearsPending()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.SetContactName('ACME', 'New Name Inc');
        Reconciler.SetCreditLimit('ACME', 2000);

        Reconciler.InitializeRecord('GLOBEX', 'Globex Corp', 500);
        Reconciler.SetContactName('GLOBEX', 'Globex International');

        Reconciler.ApproveCurrentValues('ACME');

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected approving the current values to clear every pending entry for that record');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected no fields to remain pending right after approval');
        Assert.IsTrue(Reconciler.IsPending('GLOBEX'),
            'Expected pending entries for an unrelated record to survive approving a different record');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('GLOBEX'),
            'Expected an unrelated record to keep its own pending field count when a different record was approved');

        Reconciler.SetContactName('ACME', 'Acme Corp');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected approval to move the approved value forward - setting the field back to its old value should now count as a change from the newly approved value');
    end;

    // AL compares Text with = / <> case-sensitively (confirmed by this
    // task's own discrimination probe, 2026-08-25, Cronus28).
    [Test]
    procedure X120_AValueThatDiffersOnlyInLetterCaseIsStillOnThePendingList()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'ACME CORP');

        Assert.IsTrue(Reconciler.IsFieldPending('ACME', 'Contact Name'),
            'Expected a value that differs only in letter case from the approved value to still count as a change');
        Assert.AreEqual(1, Reconciler.PendingFieldCount('ACME'),
            'Expected exactly one field pending for a case-different value');
    end;

    [Test]
    procedure X120_CrossRecordIsolationPendingOnOneRecordDoesNotAffectAnother()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);
        Reconciler.InitializeRecord('GLOBEX', 'Globex Corp', 500);

        Reconciler.SetContactName('ACME', 'Acme Corporation');

        Assert.IsTrue(Reconciler.IsPending('ACME'),
            'Expected the edited record to be pending');
        Assert.IsFalse(Reconciler.IsPending('GLOBEX'),
            'Expected an unrelated record to stay off the pending list when a different record was changed');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('GLOBEX'),
            'Expected an unrelated record to have no pending fields when a different record was changed');

        ApprovedRecord.Get('GLOBEX');
        Assert.AreEqual('Globex Corp', ApprovedRecord."Contact Name",
            'Expected the current contact name of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual(500, ApprovedRecord."Credit Limit",
            'Expected the current credit limit of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual('Globex Corp', ApprovedRecord."Approved Contact Name",
            'Expected the approved contact name of an unrelated record to be untouched by editing a different record');
        Assert.AreEqual(500, ApprovedRecord."Approved Credit Limit",
            'Expected the approved credit limit of an unrelated record to be untouched by editing a different record');
    end;

    [Test]
    procedure X120_InitializingARecordStartsFullyApprovedAndNotPending()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
        ApprovedRecord: Record "CG X120 Approved Record";
    begin
        X120_ClearAllData();

        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected a freshly initialized record to have nothing pending');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected a freshly initialized record to have zero pending fields');
        ApprovedRecord.Get('ACME');
        Assert.AreEqual('Acme Corp', ApprovedRecord."Contact Name",
            'Expected the initialized record to store the given contact name as its current value');
        Assert.AreEqual(1000, ApprovedRecord."Credit Limit",
            'Expected the initialized record to store the given credit limit as its current value');
    end;

    [Test]
    procedure X120_SettingAFieldToItsAlreadyApprovedValueIsANoOp()
    var
        Reconciler: Codeunit "CG X120 Approval Reconciler";
    begin
        X120_ClearAllData();
        Reconciler.InitializeRecord('ACME', 'Acme Corp', 1000);

        Reconciler.SetContactName('ACME', 'Acme Corp');
        Reconciler.SetCreditLimit('ACME', 1000);

        Assert.IsFalse(Reconciler.IsPending('ACME'),
            'Expected setting fields to the values they were already approved at to leave nothing pending');
        Assert.AreEqual(0, Reconciler.PendingFieldCount('ACME'),
            'Expected zero pending fields after setting fields to their own already-approved values');
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
}
