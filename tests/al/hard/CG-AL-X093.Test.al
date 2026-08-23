codeunit 89090 "CG-AL-X093 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // Default test isolation persists writes between test methods, so every
    // test clears both tables before seeding its own rows.

    local procedure ClearData()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure SeedOrder(OrderNo: Code[20]; CustomerNo: Code[20]; OrderDate: Date; var Order: Record "CG X093 Order")
    begin
        Order.Init();
        Order."No." := OrderNo;
        Order."Customer No." := CustomerNo;
        Order."Order Date" := OrderDate;
        Order.Insert();
    end;

    local procedure SeedLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; LineDescription: Text[100]; Qty: Decimal; UnitPrice: Decimal; LineAmount: Decimal; var OrderLine: Record "CG X093 Order Line")
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

    local procedure ParseExport(Order: Record "CG X093 Order") OrderObject: JsonObject
    var
        OrderExport: Codeunit "CG X093 Order Export";
        Payload: Text;
    begin
        Payload := OrderExport.ExportOrder(Order);
        Assert.IsTrue(OrderObject.ReadFrom(Payload),
            StrSubstNo('Expected ExportOrder to return well-formed JSON, but a parser rejected: %1', Payload));
    end;

    local procedure GetProperty(JsonObj: JsonObject; PropertyName: Text) Token: JsonToken
    begin
        Assert.IsTrue(JsonObj.Get(PropertyName, Token),
            StrSubstNo('Expected the exported document to contain a "%1" property', PropertyName));
    end;

    local procedure GetLine(OrderObject: JsonObject; Index: Integer) LineObject: JsonObject
    var
        LinesToken: JsonToken;
        LineToken: JsonToken;
    begin
        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.IsTrue(LinesToken.AsArray().Get(Index, LineToken),
            StrSubstNo('Expected the "lines" array to have an element at index %1', Index));
        Assert.IsTrue(LineToken.IsObject(), StrSubstNo('Expected element %1 of the "lines" array to be a JSON object', Index));
        LineObject := LineToken.AsObject();
    end;

    local procedure AssertTextProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Text)
    var
        Token: JsonToken;
    begin
        Token := GetProperty(JsonObj, PropertyName);
        Assert.AreEqual(Expected, Token.AsValue().AsText(),
            StrSubstNo('Expected the "%1" property to carry the exact value from the order', PropertyName));
    end;

    local procedure AssertNumberProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Decimal)
    var
        Token: JsonToken;
        RawValue: Text;
    begin
        Token := GetProperty(JsonObj, PropertyName);
        Assert.IsTrue(Token.IsValue(), StrSubstNo('Expected the "%1" property to be a plain JSON value, not an object or array', PropertyName));
        Token.WriteTo(RawValue);
        Assert.IsFalse(RawValue.StartsWith('"'),
            StrSubstNo('Expected the "%1" property to be an unquoted JSON number, but it serialized as %2', PropertyName, RawValue));
        Assert.AreEqual(Expected, Token.AsValue().AsDecimal(),
            StrSubstNo('Expected the "%1" property to carry the value from the order line', PropertyName));
    end;

    [Test]
    procedure ExportedDocumentIsWellFormedJson()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        ClearData();
        SeedOrder('SO-1001', 'C-1000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        ParseExport(Order);
    end;

    [Test]
    procedure HeaderFieldsRoundTripToTheExportedDocument()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-2001', 'C-2000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        AssertTextProperty(OrderObject, 'orderNo', Order."No.");
        AssertTextProperty(OrderObject, 'customerNo', Order."Customer No.");
    end;

    [Test]
    procedure OrderDateWithSingleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-3001', 'C-3000', DMY2Date(5, 1, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        DateToken := GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-01-05', DateToken.AsValue().AsText(),
            'Expected the order date January 5, 2026 to serialize as 2026-01-05');
    end;

    [Test]
    procedure OrderDateWithDoubleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-3002', 'C-3001', DMY2Date(23, 11, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        DateToken := GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-11-23', DateToken.AsValue().AsText(),
            'Expected the order date November 23, 2026 to serialize as 2026-11-23');
    end;

    [Test]
    procedure UnitPriceSerializesAsAPlainJsonNumberNotAText()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-4001', 'C-4000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 3, 1249.99, 3749.97, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'unitPrice', OrderLine."Unit Price");
    end;

    [Test]
    procedure QuantityAndLineAmountSerializeAsPlainJsonNumbers()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-5001', 'C-5000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 4.5, 20, 91.35, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'lineNo', OrderLine."Line No.");
        AssertNumberProperty(LineObject, 'quantity', OrderLine.Quantity);
        AssertNumberProperty(LineObject, 'lineAmount', OrderLine."Line Amount");
    end;

    [Test]
    procedure LineAmountIsTheStoredValueNotARecomputation()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-6001', 'C-6000', DMY2Date(15, 6, 2026), Order);
        // Line Amount deliberately does not equal Quantity * Unit Price, so a
        // recomputed export would disagree with the stored value.
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 10, 100, 850, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'lineAmount', 850);
    end;

    [Test]
    procedure LinesArrayCoversOnlyThisOrdersOwnLinesInLineNoOrder()
    var
        Order: Record "CG X093 Order";
        OtherOrder: Record "CG X093 Order";
        FirstLine: Record "CG X093 Order Line";
        SecondLine: Record "CG X093 Order Line";
        OtherLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-7001', 'C-7000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 20000, 'ITM-2', 'Second line', 1, 50, 50, SecondLine);
        SeedLine(Order."No.", 10000, 'ITM-1', 'First line', 1, 40, 40, FirstLine);
        SeedOrder('SO-7002', 'C-7001', DMY2Date(15, 6, 2026), OtherOrder);
        SeedLine(OtherOrder."No.", 10000, 'ITM-3', 'Other order line', 1, 10, 10, OtherLine);

        OrderObject := ParseExport(Order);

        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.AreEqual(2, LinesToken.AsArray().Count(),
            'Expected the "lines" array to contain only this order''s own lines, in ascending line number order');
        AssertTextProperty(GetLine(OrderObject, 0), 'itemNo', FirstLine."Item No.");
        AssertTextProperty(GetLine(OrderObject, 1), 'itemNo', SecondLine."Item No.");
    end;

    [Test]
    procedure DescriptionsWithQuotesAndBackslashesRoundTripUnchanged()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
        HostileDescription: Text[100];
    begin
        ClearData();
        HostileDescription := '24" bracket \ steel "premium"';
        SeedOrder('SO-8001', 'C-8000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', HostileDescription, 1, 40, 40, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertTextProperty(LineObject, 'description', HostileDescription);
    end;

    [Test]
    procedure OrderWithoutLinesSerializesAnEmptyLinesArray()
    var
        Order: Record "CG X093 Order";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-9001', 'C-9000', DMY2Date(15, 6, 2026), Order);

        OrderObject := ParseExport(Order);

        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array even for an order without lines');
        Assert.AreEqual(0, LinesToken.AsArray().Count(), 'Expected an empty "lines" array for an order without lines');
    end;
}
