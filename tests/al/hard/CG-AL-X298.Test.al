codeunit 89520 "CG-AL-X298 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    EventSubscriberInstance = Manual;

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
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error. A defensive clear also runs at the start of every
        // cross-company test in case a still-earlier run was aborted before it
        // could self-heal.

    // ==========================================================
    // X067 - donor CG-AL-X067
    // ==========================================================

    local procedure X067_Activate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure X067_Deactivate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure X067_ActivateFreightOverride(var Override: Codeunit "CG-AL-X298 Test")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Override);
    end;

    local procedure X067_DeactivateFreightOverride(var Override: Codeunit "CG-AL-X298 Test")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Override);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure X067_ApplyAFlatFreightOverride(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        Freight := 42.5;
        IsHandled := true;
    end;

    [Test]
    procedure X067_DefaultFreightAppliesForOrdersUnderTheThreshold()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Nothing has activated the promotion, and the order is small
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 with the promotion not activated', Amount));
    end;

    [Test]
    procedure X067_DefaultFreightAppliesJustBelowTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] One cent below the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(999.99),
            'Expected the standard charge for 999.99 with the promotion not activated - the threshold is 1000, one cent below it must not qualify');
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightWhenThePromotionHasNotBeenActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] A large order, but nothing has activated the promotion for this call
        Amount := Any.DecimalInRange(1001, 5000, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for a large order of %1 while the promotion has NOT been activated for this call', Amount));
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightAtExactlyTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] Exactly at the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(1000),
            'Expected the standard charge for an order of exactly 1000 while the promotion has NOT been activated for this call');
    end;

    [Test]
    procedure X067_ActivatedPromotionGrantsFreeFreightFromTheThresholdUpward()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        X067_Activate(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        X067_Activate(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_CalculatedFreightReflectsTheAmountAnActiveOverrideSets()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Override: Codeunit "CG-AL-X298 Test";
    begin
        // [SCENARIO] A subscriber other than the promotion has taken over this call and set its own charge
        X067_ActivateFreightOverride(Override);

        Assert.AreEqual(42.5, Calculator.CalculateFreight(1),
            'Expected the returned charge to reflect the amount an active override sets, not a fixed zero');

        X067_DeactivateFreightOverride(Override);
    end;

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
    // X118 - donor CG-AL-X118
    // ==========================================================

    local procedure X118_ClearAllData()
    var
        JournalLine: Record "CG X118 Journal Line";
        Account: Record "CG X118 Account";
        Currency: Record "CG X118 Currency";
    begin
        JournalLine.DeleteAll();
        Account.DeleteAll();
        Currency.DeleteAll();
    end;

    local procedure X118_SeedCurrency(CurrencyCode: Code[10]; RoundingPrecision: Decimal)
    var
        Currency: Record "CG X118 Currency";
    begin
        Currency.Init();
        Currency."Code" := CurrencyCode;
        Currency."Rounding Precision" := RoundingPrecision;
        Currency.Insert();
    end;

    local procedure X118_SeedAccount(AccountNo: Code[20]; CurrencyCode: Code[10])
    var
        Account: Record "CG X118 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account."Currency Code" := CurrencyCode;
        Account.Insert();
    end;

    local procedure X118_CreateLine(var JournalLine: Record "CG X118 Journal Line"; EntryNo: Integer; AccountNo: Code[20])
    begin
        JournalLine.Init();
        JournalLine."Entry No." := EntryNo;
        JournalLine.Insert(true);
        JournalLine.Validate("Account No.", AccountNo);
        JournalLine.Modify(true);
    end;

    local procedure X118_SetAmountThenCounterAccount(var JournalLine: Record "CG X118 Journal Line"; AmountValue: Decimal; CounterAccountNo: Code[20])
    begin
        JournalLine.Validate(Amount, AmountValue);
        JournalLine.Validate("Counter Account No.", CounterAccountNo);
        JournalLine.Modify(true);
    end;

    // Re-reads the entry from the table and checks all three facts a
    // balanced entry must satisfy: the recorded amount is exactly what was
    // entered (never itself adjusted), the balancing amount is its exact
    // opposite, and the two therefore net to exactly zero - so a rewrite
    // that "balances" by adjusting Amount instead of Balancing Amount, or
    // by zeroing both, cannot pass alongside a genuine fix.
    local procedure X118_AssertBalances(EntryNo: Integer; ExpectedAmount: Decimal)
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        JournalLine.Get(EntryNo);
        Assert.AreEqual(
          ExpectedAmount, JournalLine.Amount,
          StrSubstNo('Expected journal entry %1 to keep its recorded amount unchanged', EntryNo));
        Assert.AreEqual(
          -ExpectedAmount, JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s balancing amount to be the exact opposite of its amount', EntryNo));
        Assert.AreEqual(
          0.0, JournalLine.Amount + JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s amount and balancing amount to net to exactly zero', EntryNo));
    end;

    [Test]
    procedure X118_SameCurrencyOnBothAccountsBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 1, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 250.75, 'CTR-EUR');

        X118_AssertBalances(1, 250.75);
        JournalLine.Get(1);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_DifferentCurrenciesWithMatchingPrecisionBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('USD', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-USD', 'USD');
        X118_CreateLine(JournalLine, 2, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 312.40, 'CTR-USD');

        X118_AssertBalances(2, 312.40);
    end;

    [Test]
    procedure X118_AWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 3, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        X118_AssertBalances(3, 100.50);
        JournalLine.Get(3);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_ASmallRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 4, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.01, 'CTR-JPY');

        X118_AssertBalances(4, 100.01);
    end;

    [Test]
    procedure X118_AFractionalCentRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        // 100.005 is not itself a whole number of EUR cents, but it is what
        // this account's own line already carries - the fix must preserve
        // it exactly, not round it to the nearest cent along the way.
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 15, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.005, 'CTR-JPY');

        X118_AssertBalances(15, 100.005);
    end;

    [Test]
    procedure X118_AWholeAmountAgainstAWholeUnitCounterCurrencyBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 5, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.00, 'CTR-JPY');

        X118_AssertBalances(5, 100.00);
    end;

    [Test]
    procedure X118_AFinerCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-KWD', 'KWD');
        X118_CreateLine(JournalLine, 6, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-KWD');

        X118_AssertBalances(6, 100.50);
    end;

    [Test]
    procedure X118_AZeroPrecisionCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('ZPR', 0);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-ZPR', 'ZPR');
        X118_CreateLine(JournalLine, 14, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 88.37, 'CTR-ZPR');

        X118_AssertBalances(14, 88.37);
    end;

    [Test]
    procedure X118_AFinelyDenominatedMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-KWD', 'KWD');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 7, 'MAIN-KWD');

        X118_SetAmountThenCounterAccount(JournalLine, 45.678, 'CTR-JPY');

        X118_AssertBalances(7, 45.678);
    end;

    [Test]
    procedure X118_NoMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-LOCAL', '');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 8, 'MAIN-LOCAL');

        X118_SetAmountThenCounterAccount(JournalLine, 75.60, 'CTR-JPY');

        X118_AssertBalances(8, 75.60);
    end;

    [Test]
    procedure X118_ClearingTheCounterAccountLeavesNothingToBalance()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 9, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        JournalLine.Validate("Counter Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(9);
        Assert.AreEqual(100.50, JournalLine.Amount,
          'Expected clearing the counter account on a journal entry to leave its recorded amount untouched');
        Assert.AreEqual(0.0, JournalLine."Balancing Amount",
          'Expected clearing the counter account on a journal entry to leave it with nothing to balance');
    end;

    [Test]
    procedure X118_ClearingTheAccountNoAlsoClearsTheCurrencyCode()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 16, 'MAIN-EUR');

        JournalLine.Validate("Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(16);
        Assert.AreEqual('', JournalLine."Currency Code",
          'Expected clearing the account on a journal entry to also clear its currency');

        X118_SetAmountThenCounterAccount(JournalLine, 60.30, 'CTR-EUR');

        X118_AssertBalances(16, 60.30);
    end;

    [Test]
    procedure X118_AmountChangesAfterTheCounterAccountIsSetStillBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 10, 'MAIN-EUR');

        JournalLine.Validate("Counter Account No.", 'CTR-JPY');
        JournalLine.Validate(Amount, 100.50);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 100.50);

        JournalLine.Validate(Amount, 60.25);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 60.25);
    end;

    [Test]
    procedure X118_SettingAnUnknownCounterAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_CreateLine(JournalLine, 11, 'MAIN-EUR');
        JournalLine.Validate(Amount, 100.00);
        JournalLine.Modify(true);

        asserterror JournalLine.Validate("Counter Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_SettingAnUnknownAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        JournalLine.Init();
        JournalLine."Entry No." := 12;
        JournalLine.Insert(true);

        asserterror JournalLine.Validate("Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_UnrelatedEntriesAreNeverTouched()
    var
        JournalLine: Record "CG X118 Journal Line";
        OtherLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        OtherLine.Init();
        OtherLine."Entry No." := 999;
        OtherLine.Amount := 321.00;
        OtherLine."Balancing Amount" := 777.77;
        OtherLine.Insert();

        X118_CreateLine(JournalLine, 13, 'MAIN-EUR');
        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');
        X118_AssertBalances(13, 100.50);

        OtherLine.Get(999);
        Assert.AreEqual(777.77, OtherLine."Balancing Amount",
          'Expected a journal entry that was never revalidated in this test to keep its recorded balancing amount untouched');
        Assert.AreEqual(321.00, OtherLine.Amount,
          'Expected a journal entry that was never revalidated in this test to keep its recorded amount untouched');
    end;

    [Test]
    procedure X118_RandomCoarseCurrencyAmountsAlwaysBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
        Any: Codeunit Any;
        EntryNo: Integer;
        AmountValue: Decimal;
        i: Integer;
    begin
        // Amounts are drawn to three decimal places - one more than EUR's
        // own 0.01 precision - so a fix that rounds to the line's own
        // currency instead of the counter's fails on essentially every
        // draw here, not just the single hand-picked case above.
        X118_ClearAllData();
        Any.SetSeed(118);
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        for i := 1 to 8 do begin
            EntryNo := 100 + i;
            AmountValue := Any.IntegerInRange(1000, 999999) / 1000;
            X118_CreateLine(JournalLine, EntryNo, 'MAIN-EUR');
            X118_SetAmountThenCounterAccount(JournalLine, AmountValue, 'CTR-JPY');
            X118_AssertBalances(EntryNo, AmountValue);
        end;
    end;

    // ==========================================================
    // X163 - donor CG-AL-X163
    // ==========================================================

    local procedure X163_GetOtherCompanyName(): Text[30]
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

    local procedure X163_ClearHomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearOtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearQueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure X163_ClearBoth(OtherName: Text[30])
    begin
        X163_ClearHomeLedger();
        X163_ClearOtherLedger(OtherName);
        X163_ClearQueryLog();
        Commit();
    end;

    [Test]
    procedure X163_TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(67.75, Total,
            'Expected the group total for the account to combine every branch''s own configured amount for it');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheOtherBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheHomeBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-C', 30.0);

        Total := GroupTotals.GetGroupTotal('ACCT-C');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(30.0, Total,
            'Expected an account configured only on the home branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_TheGroupTotalForOneAccountIsNotContaminatedByAnotherAccountInTheSameBranch()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-P', 12.0);
        LedgerMgt.SetAmount(CompanyName(), 'ACCT-Q', 999.0);

        Total := GroupTotals.GetGroupTotal('ACCT-P');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(12.0, Total,
            'Expected the group total for one account to be unaffected by a different account configured in the same branch');
    end;

    [Test]
    procedure X163_AnAccountWithNoConfiguredAmountAnywhereTotalsToZero()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Total := GroupTotals.GetGroupTotal('ACCT-Z');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(0.0, Total,
            'Expected an account with no configured amount on any branch to total to zero');
    end;

    [Test]
    procedure X163_EachBranchsConfiguredAmountIsStoredOnItsOwnRecordUnaffectedByTheOtherBranch()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeLedger: Record "CG X163 Branch Ledger";
        OtherLedger: Record "CG X163 Branch Ledger";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        HomeName := CompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(HomeName, 'ACCT-M', 17.0);
        LedgerMgt.SetAmount(OtherName, 'ACCT-M', 9.0);

        HomeDirect := LedgerMgt.GetAmountDirect(HomeName, 'ACCT-M');
        OtherDirect := LedgerMgt.GetAmountDirect(OtherName, 'ACCT-M');

        HomeLedger.Get('ACCT-M');
        OtherLedger.ChangeCompany(OtherName);
        OtherLedger.Get('ACCT-M');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(17.0, HomeDirect,
            'Expected the home branch''s configured amount to be unaffected by the other branch''s configured amount for the same account');
        Assert.AreEqual(9.0, OtherDirect,
            'Expected the other branch''s configured amount to reflect what it configured for itself');
        Assert.AreEqual(17.0, HomeLedger.Amount,
            'Expected the home branch''s amount to be persisted with its own value on its own record');
        Assert.AreEqual(9.0, OtherLedger.Amount,
            'Expected the other branch''s amount to be persisted with its own value on its own record');
    end;

    [Test]
    procedure X163_ABranchWithNoConfiguredAmountForAGivenAccountIsTreatedAsZero()
    var
        OtherName: Text[30];
        Direct: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Direct := LedgerMgt.GetAmountDirect(CompanyName(), 'ACCT-N');

        Assert.AreEqual(0.0, Direct,
            'Expected no configured amount for an account on a branch to read as zero rather than an arbitrary leftover value');
    end;
}
