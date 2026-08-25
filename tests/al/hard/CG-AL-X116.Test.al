codeunit 89310 "CG-AL-X116 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure SingleInvoiceRendersNumberSpaceAmount()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] One applied invoice becomes one entry with two forced decimals
        Composer.AddInvoice('INV-1001', 250);

        Assert.AreEqual('INV-1001 250.00', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number, one space, and the amount with exactly two decimals');
    end;

    [Test]
    procedure EntriesAreJoinedWithCommaAndSpace()
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
    procedure LargeAmountRendersAsPlainDigits()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A large amount stays plain digits with a dot and two decimals
        Composer.AddInvoice('INV-2001', 1234567.8);

        Assert.AreEqual('INV-2001 1234567.80', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number followed by a space and the amount as plain digits');
    end;

    [Test]
    procedure NoInvoicesYieldEmptyText()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A composer with nothing added produces an empty remittance line
        Assert.AreEqual('', Composer.GetRemittanceText(),
            'Expected an empty text when no invoice was added');
    end;

    [Test]
    procedure ExactlyFullCapacityComesBackUntouched()
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
    procedure SingleEntryOfExactlyFullCapacityIsAccepted()
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
    procedure OneCharacterOverflowDropsTheLastEntry()
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
    procedure SuffixSpaceForcesARecountOfTheOmitted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] The suffix claims its own space: appending it pushes one more entry out
        // [GIVEN] 13 entries of 12 characters - 10 fit without a suffix (138), but only 9 fit next to it
        for Index := 1 to 13 do
            Composer.AddInvoice(SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 4 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 13 added invoices to keep 9 entries and end with the matching omitted-count suffix');
    end;

    [Test]
    procedure SuffixedTextOfExactly140IsKept()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A suffixed text of exactly 140 characters stays within the limit - no extra entry may be left out
        // [GIVEN] 12 entries of 11 characters: the full join is 154, but 10 entries (128) plus ', and 2 more' (12) land on exactly 140
        for Index := 1 to 12 do
            Composer.AddInvoice(FiveCharInvoiceNo(Index), 10.12);
        for Index := 1 to 10 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += FiveCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 2 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected 10 kept entries and "and 2 more": the suffixed text lands on exactly 140 characters, which still fits the limit');
    end;

    [Test]
    procedure OnlyTheSuffixRemainsWhenNotEvenTheFirstEntryFits()
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
    procedure OverlongSingleEntryRaisesAnError()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry longer than 140 characters can never be sent and must be refused
        // [GIVEN] an invoice number of 135 characters - the entry is 135 + 1 + 5 = 141, one over the limit
        asserterror Composer.AddInvoice(PadStr('TRYAL-HUGE-', 135, 'X'), 10.12);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure GeneratedAmountsAreRenderedExactly()
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

        Assert.AreEqual('TRYAL-G1 ' + InvariantAmount(AmountA) + ', TRYAL-G2 ' + InvariantAmount(AmountB),
            Composer.GetRemittanceText(),
            StrSubstNo('Expected the amounts %1 and %2 rendered with a dot and exactly two decimals, joined by ", "', AmountA, AmountB));
    end;

    [Test]
    procedure GeneratedInvoiceCountDrivesTheSuffix()
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
            Composer.AddInvoice(SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += StrSubstNo(', and %1 more', Total - 9);

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            StrSubstNo('Expected the remittance text for %1 added invoices to keep 9 entries and end with the matching omitted-count suffix', Total));
    end;

    [Test]
    procedure LargeInvoiceCountStaysWithinTheLimit()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A much larger batch still ends up within the 140-character limit
        // [GIVEN] 40 entries of 8 characters - 14 fit without a suffix (138), but only 12 fit next to it
        for Index := 1 to 40 do
            Composer.AddInvoice(TwoCharInvoiceNo(Index), 10.12);
        for Index := 1 to 12 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += TwoCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 28 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 40 added invoices to keep 12 entries and end with the matching omitted-count suffix, staying within the 140-character limit');
    end;

    [Test]
    procedure WholeNumberAmountAtFullCapacityIsAccepted()
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
    procedure WholeNumberAmountOneOverCapacityIsRejected()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry built from a whole-number amount is refused once it is one character over the limit
        // [GIVEN] an invoice number of 134 characters - the entry is 134 + 1 + 6 = 141
        asserterror Composer.AddInvoice(PadStr('TRYAL-WFULL-B-', 134, 'X'), 250);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure RejectedInvoiceIsNotRecordedAlongsideEarlierOnes()
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

    local procedure TwoCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('0' + Format(Index));
        exit(Format(Index));
    end;

    local procedure SixCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV-0' + Format(Index));
        exit('INV-' + Format(Index));
    end;

    local procedure FiveCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV0' + Format(Index));
        exit('INV' + Format(Index));
    end;

    local procedure InvariantAmount(Value: Decimal): Text
    begin
        exit(Format(Value, 0, '<Precision,2:2><Standard Format,9>'));
    end;
}
