codeunit 89515 "CG-AL-X293 Test"
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
        // every test clears the table before seeding its own rows.
        // Default test isolation persists writes between test methods, so every
        // test clears both tables before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured, SOAP runner), so every test that seeds rows clears the
        // table first. A second, unrelated batch is seeded with nonzero
        // sentinel values wherever isolation is under test, so "untouched" and
        // "wiped" stay distinguishable.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.

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
    // X093 - donor CG-AL-X093
    // ==========================================================

    local procedure X093_ClearData()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure X093_SeedOrder(OrderNo: Code[20]; CustomerNo: Code[20]; OrderDate: Date; var Order: Record "CG X093 Order")
    begin
        Order.Init();
        Order."No." := OrderNo;
        Order."Customer No." := CustomerNo;
        Order."Order Date" := OrderDate;
        Order.Insert();
    end;

    local procedure X093_SeedLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; LineDescription: Text[100]; Qty: Decimal; UnitPrice: Decimal; LineAmount: Decimal; var OrderLine: Record "CG X093 Order Line")
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine."Item No." := ItemNo;
        OrderLine.Description := LineDescription;
        OrderLine.Quantity := Qty;
        OrderLine."Unit Price" := UnitPrice;
        OrderLine."Line Amount" := LineAmount;
        OrderLine.Insert();
    end;

    local procedure X093_ParseExport(Order: Record "CG X093 Order") OrderObject: JsonObject
    var
        OrderExport: Codeunit "CG X093 Order Export";
        Payload: Text;
    begin
        Payload := OrderExport.ExportOrder(Order);
        Assert.IsTrue(OrderObject.ReadFrom(Payload),
            StrSubstNo('Expected ExportOrder to return well-formed JSON, but a parser rejected: %1', Payload));
    end;

    local procedure X093_GetProperty(JsonObj: JsonObject; PropertyName: Text) Token: JsonToken
    begin
        Assert.IsTrue(JsonObj.Get(PropertyName, Token),
            StrSubstNo('Expected the exported document to contain a "%1" property', PropertyName));
    end;

    local procedure X093_GetLine(OrderObject: JsonObject; Index: Integer) LineObject: JsonObject
    var
        LinesToken: JsonToken;
        LineToken: JsonToken;
    begin
        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.IsTrue(LinesToken.AsArray().Get(Index, LineToken),
            StrSubstNo('Expected the "lines" array to have an element at index %1', Index));
        Assert.IsTrue(LineToken.IsObject(), StrSubstNo('Expected element %1 of the "lines" array to be a JSON object', Index));
        LineObject := LineToken.AsObject();
    end;

    local procedure X093_AssertTextProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Text)
    var
        Token: JsonToken;
    begin
        Token := X093_GetProperty(JsonObj, PropertyName);
        Assert.AreEqual(Expected, Token.AsValue().AsText(),
            StrSubstNo('Expected the "%1" property to carry the exact value from the order', PropertyName));
    end;

    local procedure X093_AssertNumberProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Decimal)
    var
        Token: JsonToken;
        RawValue: Text;
    begin
        Token := X093_GetProperty(JsonObj, PropertyName);
        Assert.IsTrue(Token.IsValue(), StrSubstNo('Expected the "%1" property to be a plain JSON value, not an object or array', PropertyName));
        Token.WriteTo(RawValue);
        Assert.IsFalse(RawValue.StartsWith('"'),
            StrSubstNo('Expected the "%1" property to be an unquoted JSON number, but it serialized as %2', PropertyName, RawValue));
        Assert.AreEqual(Expected, Token.AsValue().AsDecimal(),
            StrSubstNo('Expected the "%1" property to carry the value from the order line', PropertyName));
    end;

    [Test]
    procedure X093_ExportedDocumentIsWellFormedJson()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        X093_ClearData();
        X093_SeedOrder('SO-1001', 'C-1000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        X093_ParseExport(Order);
    end;

    [Test]
    procedure X093_HeaderFieldsRoundTripToTheExportedDocument()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-2001', 'C-2000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        X093_AssertTextProperty(OrderObject, 'orderNo', Order."No.");
        X093_AssertTextProperty(OrderObject, 'customerNo', Order."Customer No.");
    end;

    [Test]
    procedure X093_OrderDateWithSingleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-3001', 'C-3000', DMY2Date(5, 1, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        DateToken := X093_GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-01-05', DateToken.AsValue().AsText(),
            'Expected the order date January 5, 2026 to serialize as 2026-01-05');
    end;

    [Test]
    procedure X093_OrderDateWithDoubleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-3002', 'C-3001', DMY2Date(23, 11, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := X093_ParseExport(Order);

        DateToken := X093_GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-11-23', DateToken.AsValue().AsText(),
            'Expected the order date November 23, 2026 to serialize as 2026-11-23');
    end;

    [Test]
    procedure X093_UnitPriceSerializesAsAPlainJsonNumberNotAText()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-4001', 'C-4000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 3, 1249.99, 3749.97, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'unitPrice', OrderLine."Unit Price");
    end;

    [Test]
    procedure X093_QuantityAndLineAmountSerializeAsPlainJsonNumbers()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-5001', 'C-5000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 4.5, 20, 91.35, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'lineNo', OrderLine."Line No.");
        X093_AssertNumberProperty(LineObject, 'quantity', OrderLine.Quantity);
        X093_AssertNumberProperty(LineObject, 'lineAmount', OrderLine."Line Amount");
    end;

    [Test]
    procedure X093_LineAmountIsTheStoredValueNotARecomputation()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-6001', 'C-6000', DMY2Date(15, 6, 2026), Order);
        // Line Amount deliberately does not equal Quantity * Unit Price, so a
        // recomputed export would disagree with the stored value.
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 10, 100, 850, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertNumberProperty(LineObject, 'lineAmount', 850);
    end;

    [Test]
    procedure X093_LinesArrayCoversOnlyThisOrdersOwnLinesInLineNoOrder()
    var
        Order: Record "CG X093 Order";
        OtherOrder: Record "CG X093 Order";
        FirstLine: Record "CG X093 Order Line";
        SecondLine: Record "CG X093 Order Line";
        OtherLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-7001', 'C-7000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 20000, 'ITM-2', 'Second line', 1, 50, 50, SecondLine);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', 'First line', 1, 40, 40, FirstLine);
        X093_SeedOrder('SO-7002', 'C-7001', DMY2Date(15, 6, 2026), OtherOrder);
        X093_SeedLine(OtherOrder."No.", 10000, 'ITM-3', 'Other order line', 1, 10, 10, OtherLine);

        OrderObject := X093_ParseExport(Order);

        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.AreEqual(2, LinesToken.AsArray().Count(),
            'Expected the "lines" array to contain only this order''s own lines, in ascending line number order');
        X093_AssertTextProperty(X093_GetLine(OrderObject, 0), 'itemNo', FirstLine."Item No.");
        X093_AssertTextProperty(X093_GetLine(OrderObject, 1), 'itemNo', SecondLine."Item No.");
    end;

    [Test]
    procedure X093_DescriptionsWithQuotesAndBackslashesRoundTripUnchanged()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
        HostileDescription: Text[100];
    begin
        X093_ClearData();
        HostileDescription := '24" bracket \ steel "premium"';
        X093_SeedOrder('SO-8001', 'C-8000', DMY2Date(15, 6, 2026), Order);
        X093_SeedLine(Order."No.", 10000, 'ITM-1', HostileDescription, 1, 40, 40, OrderLine);

        LineObject := X093_GetLine(X093_ParseExport(Order), 0);

        X093_AssertTextProperty(LineObject, 'description', HostileDescription);
    end;

    [Test]
    procedure X093_OrderWithoutLinesSerializesAnEmptyLinesArray()
    var
        Order: Record "CG X093 Order";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        X093_ClearData();
        X093_SeedOrder('SO-9001', 'C-9000', DMY2Date(15, 6, 2026), Order);

        OrderObject := X093_ParseExport(Order);

        LinesToken := X093_GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array even for an order without lines');
        Assert.AreEqual(0, LinesToken.AsArray().Count(), 'Expected an empty "lines" array for an order without lines');
    end;

    // ==========================================================
    // X106 - donor CG-AL-X106
    // ==========================================================

    local procedure X106_Seed(No: Code[20]; BaseTotal: Integer)
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Init();
        Doc."No." := No;
        Doc."Base Total" := BaseTotal;
        Doc.Insert();
    end;

    [Test]
    procedure X106_ArchivingAQualifyingDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC001', 100);

        ArchiveMgt.ArchiveDocument('DOC001');

        Doc.Get('DOC001');
        Assert.AreEqual('NOTE-100', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at the qualifying total must be tagged as priority');
        Assert.AreEqual(100, Doc."Base Total", 'Archiving must not change the document''s recorded total');
    end;

    [Test]
    procedure X106_ArchivingABelowThresholdDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC002', 99);

        ArchiveMgt.ArchiveDocument('DOC002');

        Doc.Get('DOC002');
        Assert.AreEqual('NOTE-99', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
    end;

    [Test]
    procedure X106_ArchivingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X106 Document";
        Other: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Target.DeleteAll();
        Target.Init();
        Target."No." := 'TARGET';
        Target."Base Total" := 250;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other."Base Total" := 555;
        Other."Enrichment Note" := 'UNTOUCHED-NOTE';
        Other."Archive Tag" := 'UNTOUCHED-TAG';
        Other.Insert();

        ArchiveMgt.ArchiveDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(555, Other."Base Total", 'An unrelated document''s total must not change');
        Assert.AreEqual('UNTOUCHED-NOTE', Other."Enrichment Note", 'An unrelated document''s enrichment note must not change');
        Assert.AreEqual('UNTOUCHED-TAG', Other."Archive Tag", 'An unrelated document''s archive tag must not change');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneLeavesTheEnrichmentNoteUntouched()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC003';
        Doc."Base Total" := 400;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC003');

        Doc.Get('DOC003');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at or above the qualifying total must be tagged as priority');
        Assert.AreEqual('PRESEEDED-NOTE', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneHandlesTheStandardCase()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC004';
        Doc."Base Total" := 20;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE-2';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC004');

        Doc.Get('DOC004');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
        Assert.AreEqual('PRESEEDED-NOTE-2', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    // ==========================================================
    // X131 - donor CG-AL-X131
    // ==========================================================

    local procedure X131_MakeLine(var ImportLine: Record "CG X131 Import Line"; BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Item No." := ItemNo;
        ImportLine.Quantity := NewQuantity;
        ImportLine."Unit Cost" := NewUnitCost;
    end;

    local procedure X131_InsertLine(BatchCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; NewQuantity: Decimal; NewUnitCost: Decimal)
    var
        ImportLine: Record "CG X131 Import Line";
    begin
        X131_MakeLine(ImportLine, BatchCode, LineNo, ItemNo, NewQuantity, NewUnitCost);
        ImportLine.Insert();
    end;

    [Test]
    procedure X131_CheckLineAcceptsAFullyValidLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A line satisfying every rule should report no problems');
    end;

    [Test]
    procedure X131_CheckLineAcceptsAZeroUnitCost()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 5, 0);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Unit Cost of exactly 0 is allowed - only a negative cost is a problem');
    end;

    [Test]
    procedure X131_CheckLineAcceptsAQuantityJustAboveZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, 'ITEM-1', 0.01, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(0, LineMessages.Count(), 'A Quantity just above zero is allowed - only zero or below is a problem');
    end;

    [Test]
    procedure X131_CheckLineReportsAMissingItemNo()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 10000, '', 5, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A blank Item No. is the only problem on this line');
        Assert.AreEqual('Line 10000: Item No. is missing.', LineMessages.Get(1), 'Expected the missing-item message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsAZeroQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', 0, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A zero Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsANegativeQuantity()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 20000, 'ITEM-1', -3, 10);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A negative Quantity is the only problem on this line');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected the quantity message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsAUnitCostJustBelowZero()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 30000, 'ITEM-1', 5, -0.01);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A Unit Cost just below zero is the only problem on this line');
        Assert.AreEqual('Line 30000: Unit Cost cannot be negative.', LineMessages.Get(1), 'Expected the unit cost message with the line''s own number');
    end;

    [Test]
    procedure X131_CheckLineReportsOnlyTheFirstRuleWhenAllThreeAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 40000, '', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line breaking every rule must still report exactly one problem - its first broken rule');
        Assert.AreEqual('Line 40000: Item No. is missing.', LineMessages.Get(1), 'Expected the FIRST rule in the order (Item No., then Quantity, then Unit Cost) to be the one reported');
    end;

    [Test]
    procedure X131_CheckLineReportsTheQuantityRuleWhenItemIsValidButQuantityAndCostAreBroken()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        LineMessages: List of [Text];
    begin
        X131_MakeLine(ImportLine, 'ONE-OFF', 50000, 'ITEM-1', 0, -5);

        Checker.CheckLine(ImportLine, LineMessages);

        Assert.AreEqual(1, LineMessages.Count(), 'A line with a valid Item No. but two broken rules must still report exactly one problem');
        Assert.AreEqual('Line 50000: Quantity must be greater than zero.', LineMessages.Get(1), 'Expected Quantity - the earlier rule of the two remaining - to be the one reported, not Unit Cost');
    end;

    [Test]
    procedure X131_CheckBatchReportsOneMessagePerProblemLine()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-A', 10000, 'ITEM-1', 5, 10);
        X131_InsertLine('BATCH-A', 20000, 'ITEM-2', 0, 10);
        X131_InsertLine('BATCH-A', 30000, '', 0, -5);
        X131_InsertLine('BATCH-A', 40000, 'ITEM-4', 3, 8);

        Checker.CheckBatch('BATCH-A', Problems);

        Assert.AreEqual(2, Problems.Count(), 'Expected exactly one problem per problem line - two lines are broken, not more entries for the line breaking several rules');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(1), 'Expected the first problem to belong to line 20000, in line order');
        Assert.AreEqual('Line 30000: Item No. is missing.', Problems.Get(2), 'Expected the second problem to be line 30000''s FIRST broken rule, not one entry per rule it breaks');
    end;

    [Test]
    procedure X131_CheckBatchIgnoresLinesOfOtherBatches()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-B1', 10000, '', 5, 10);
        X131_InsertLine('BATCH-B2', 20000, '', 7, 20);

        Checker.CheckBatch('BATCH-B1', Problems);

        Assert.AreEqual(1, Problems.Count(), 'The other batch''s broken line must not leak into this batch''s result');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the reported problem to belong to the requested batch');

        ImportLine.Get('BATCH-B2', 20000);
        Assert.AreEqual('', ImportLine."Item No.", 'The other batch''s line must be left exactly as seeded');
        Assert.AreEqual(7, ImportLine.Quantity, 'The other batch''s Quantity must survive untouched');
        Assert.AreEqual(20, ImportLine."Unit Cost", 'The other batch''s Unit Cost must survive untouched');
    end;

    [Test]
    procedure X131_CheckBatchReturnsAnEmptyListForACleanBatch()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-C', 10000, 'ITEM-1', 5, 10);
        X131_InsertLine('BATCH-C', 20000, 'ITEM-2', 3, 0);

        Checker.CheckBatch('BATCH-C', Problems);

        Assert.AreEqual(0, Problems.Count(), 'A batch where every line passes every rule must report no problems');
    end;

    [Test]
    procedure X131_CheckBatchReplacesEarlierListContents()
    var
        ImportLine: Record "CG X131 Import Line";
        Checker: Codeunit "CG X131 Import Checker";
        Problems: List of [Text];
    begin
        ImportLine.DeleteAll();
        X131_InsertLine('BATCH-D', 10000, '', 5, 10);
        X131_InsertLine('BATCH-D', 20000, 'ITEM-2', 0, 10);

        Checker.CheckBatch('BATCH-D', Problems);
        Checker.CheckBatch('BATCH-D', Problems);

        Assert.AreEqual(2, Problems.Count(), 'A second run must replace the first run''s findings, not add to them');
        Assert.AreEqual('Line 10000: Item No. is missing.', Problems.Get(1), 'Expected the first problem of the second run to still be line 10000');
        Assert.AreEqual('Line 20000: Quantity must be greater than zero.', Problems.Get(2), 'Expected the second problem of the second run to still be line 20000');
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
