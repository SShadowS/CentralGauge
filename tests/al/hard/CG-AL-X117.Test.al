codeunit 89311 "CG-AL-X117 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.
    //
    // The two dedicated date tests below, and the date sweep further
    // down, assume the container's session locale renders a bare
    // Format(Date) month-first with a 2-digit year (measured US on the
    // bench containers, decisions entry 16). On a locale that already
    // renders dates year-first, an unfixed Format(Date) call could
    // coincidentally produce the same string as the fixed one and those
    // tests would pass without the fix.

    local procedure Cleanup()
    var
        Order: Record "CG X117 Sales Order";
        OrderLine: Record "CG X117 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure CreateOrder(No: Code[20]; CustomerNo: Code[20]; CustomerName: Text[100]; OrderDate: Date)
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

    local procedure AddLine(DocumentNo: Code[20]; LineNo: Integer; No: Code[20]; LineDescription: Text[100]; Quantity: Decimal; UnitPrice: Decimal)
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

    local procedure ExportToXml(OrderNo: Code[20]; var Doc: XmlDocument)
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
    local procedure IsoDay(Value: Date): Text
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

    local procedure AttributeValue(Doc: XmlDocument; XPath: Text): Text
    var
        Node: XmlNode;
    begin
        Assert.IsTrue(Doc.SelectSingleNode(XPath, Node), StrSubstNo('Expected the exported document to contain %1', XPath));
        exit(Node.AsXmlAttribute().Value());
    end;

    local procedure ElementText(Doc: XmlDocument; XPath: Text): Text
    var
        Node: XmlNode;
    begin
        Assert.IsTrue(Doc.SelectSingleNode(XPath, Node), StrSubstNo('Expected the exported document to contain %1', XPath));
        exit(Node.AsXmlElement().InnerText());
    end;

    [Test]
    procedure OrderDateReadableTwoWaysIsExportedAsOneUnambiguousDay()
    var
        Doc: XmlDocument;
    begin
        // [SCENARIO] 4 July 2026 has a day and a month that are both valid
        // read the other way around; the receiving system must not be able
        // to mistake it for a different calendar day.
        Cleanup();
        CreateOrder('ORD001', 'CUST001', 'Existing Customer', 20260704D);
        AddLine('ORD001', 10000, 'ITEM001', 'Existing Item', 2, 100);

        ExportToXml('ORD001', Doc);

        Assert.AreEqual('2026-07-04', AttributeValue(Doc, '/SalesOrder/@orderDate'),
            'Expected the exported order date to name 4 July 2026 as a single, unambiguous calendar day, regardless of the server''s regional settings');
    end;

    [Test]
    procedure OrderDateLaterInTheMonthIsExportedCorrectly()
    var
        Doc: XmlDocument;
    begin
        // [SCENARIO] 23 November 2026 is later in the month than the July
        // case above; the exported date must still be read correctly.
        Cleanup();
        CreateOrder('ORD002', 'CUST002', 'Existing Customer', 20261123D);
        AddLine('ORD002', 10000, 'ITEM002', 'Existing Item', 1, 50);

        ExportToXml('ORD002', Doc);

        Assert.AreEqual('2026-11-23', AttributeValue(Doc, '/SalesOrder/@orderDate'),
            'Expected the exported order date to name 23 November 2026, regardless of the server''s regional settings');
    end;

    [Test]
    procedure RootAttributesIdentifyTheOrderAndCustomer()
    var
        Doc: XmlDocument;
        Root: XmlElement;
    begin
        // [SCENARIO] The parts of the document that already work correctly
        // must keep working: root element name, order/customer identity,
        // and the customer's name.
        Cleanup();
        CreateOrder('ORD010', 'CUST010', 'Northwind Traders', 20260115D);
        AddLine('ORD010', 10000, 'ITEM010', 'Blue Widget', 3, 20);

        ExportToXml('ORD010', Doc);

        Assert.IsTrue(Doc.GetRoot(Root), 'Expected the exported document to have a root element');
        Assert.AreEqual('SalesOrder', Root.LocalName(), 'Expected the root element to be named SalesOrder');
        Assert.AreEqual('ORD010', AttributeValue(Doc, '/SalesOrder/@no'),
            'Expected the root''s no attribute to carry the order number');
        Assert.AreEqual('CUST010', AttributeValue(Doc, '/SalesOrder/@customerNo'),
            'Expected the root''s customerNo attribute to carry the customer number');
        Assert.AreEqual('Northwind Traders', ElementText(Doc, '/SalesOrder/Customer/Name'),
            'Expected the Customer/Name element to carry the customer''s name');
    end;

    [Test]
    procedure EveryLineIsExportedInLineNoOrderWithItsOwnValues()
    var
        Doc: XmlDocument;
        LineList: XmlNodeList;
    begin
        // [SCENARIO] Line elements come out in ascending Line No. order,
        // each carrying its own number, description, quantity and price.
        Cleanup();
        CreateOrder('ORD020', 'CUST020', 'Existing Customer', 20260601D);
        AddLine('ORD020', 10000, 'ITEM020A', 'First Item', 2, 15.5);
        AddLine('ORD020', 20000, 'ITEM020B', 'Second Item', 7, 193.7);

        ExportToXml('ORD020', Doc);

        Assert.IsTrue(Doc.SelectNodes('/SalesOrder/Lines/Line', LineList),
            'Expected the exported document to contain Line elements');
        Assert.AreEqual(2, LineList.Count(), 'Expected exactly one Line element per order line');
        Assert.AreEqual('10000', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@lineNo'),
            'Expected the first Line element to carry the lower Line No.');
        Assert.AreEqual('ITEM020A', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@no'),
            'Expected the first Line element to carry the first line''s number');
        Assert.AreEqual('First Item', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@description'),
            'Expected the first Line element to carry the first line''s description');
        Assert.AreEqual('2', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@quantity'),
            'Expected a whole-number quantity to render with no decimal point');
        Assert.AreEqual('15.5', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@unitPrice'),
            'Expected the first line''s unit price to render exactly as 15.5');
        Assert.AreEqual('20000', AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@lineNo'),
            'Expected the second Line element to carry the higher Line No.');
        Assert.AreEqual('ITEM020B', AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@no'),
            'Expected the second Line element to carry the second line''s number');
        Assert.AreEqual('Second Item', AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@description'),
            'Expected the second Line element to carry the second line''s description');
        Assert.AreEqual('7', AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@quantity'),
            'Expected a whole-number quantity of 7 to render as 7, not 7.00');
        Assert.AreEqual('193.7', AttributeValue(Doc, '/SalesOrder/Lines/Line[2]/@unitPrice'),
            'Expected a unit price of 193.7 to render with no trailing decimal zeros');
    end;

    [Test]
    procedure LinesFromAnotherOrderAreNotIncluded()
    var
        Doc: XmlDocument;
        LineList: XmlNodeList;
    begin
        // [SCENARIO] Exporting one order must not pull in another order's
        // lines.
        Cleanup();
        CreateOrder('ORD030', 'CUST030', 'Existing Customer', 20260210D);
        AddLine('ORD030', 10000, 'ITEM030', 'Item A', 1, 10);
        CreateOrder('ORD031', 'CUST031', 'Existing Customer', 20260210D);
        AddLine('ORD031', 10000, 'ITEM031', 'Item B', 5, 999);
        AddLine('ORD031', 20000, 'ITEM031B', 'Item C', 6, 888);

        ExportToXml('ORD030', Doc);

        Assert.IsTrue(Doc.SelectNodes('/SalesOrder/Lines/Line', LineList),
            'Expected the exported document to contain Line elements');
        Assert.AreEqual(1, LineList.Count(),
            'Expected only the exported order''s own line, not lines belonging to another order');
        Assert.AreEqual('ITEM030', AttributeValue(Doc, '/SalesOrder/Lines/Line[1]/@no'),
            'Expected the single exported line to be the requested order''s own line');
    end;

    [Test]
    procedure DocumentCarriesAWellFormedXmlDeclaration()
    var
        Doc: XmlDocument;
        Declaration: XmlDeclaration;
    begin
        // [SCENARIO] The receiving system's parser expects a declaration
        // stating version and encoding.
        Cleanup();
        CreateOrder('ORD040', 'CUST040', 'Existing Customer', 20260320D);
        AddLine('ORD040', 10000, 'ITEM040', 'Existing Item', 1, 10);

        ExportToXml('ORD040', Doc);

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
    procedure OrderDateMatchesTheIsoRenderingAcrossAFullSweep()
    var
        Doc: XmlDocument;
        SweepDate: Date;
        DayOffset: Integer;
    begin
        for DayOffset := 0 to 40 do begin
            Cleanup();
            SweepDate := 20261125D + DayOffset;
            CreateOrder('ORDSWEEP', 'CUSTSWP', 'Existing Customer', SweepDate);
            AddLine('ORDSWEEP', 10000, 'ITEMSWP', 'Existing Item', 1, 10);

            ExportToXml('ORDSWEEP', Doc);

            Assert.AreEqual(IsoDay(SweepDate), AttributeValue(Doc, '/SalesOrder/@orderDate'),
                StrSubstNo('Expected the exported order date to identify %1 as a single calendar day, regardless of the server''s regional settings', IsoDay(SweepDate)));
        end;
    end;

    [Test]
    procedure ExportingAnUnknownOrderFails()
    var
        Export: Codeunit "CG X117 Order Xml Export";
        ExportedXml: Text;
    begin
        // [SCENARIO] There is no order to export, so the call must fail
        // rather than silently produce an empty or partial document.
        Cleanup();

        asserterror Export.ExportOrder('NOPE', ExportedXml);
    end;
}
