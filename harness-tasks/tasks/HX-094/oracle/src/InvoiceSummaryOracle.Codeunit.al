codeunit 87340 "HX094 Invoice Summary Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('01', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, -10);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 0, 'S1');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 1, 'S1');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'A', 100, 10, 'S1');
        HX094AssertNoNegative(Lines, 'S1');
        HX094AssertHeader(Header, InvoiceNo, 100, 0, 10, 110, 'S1');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario02()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('02', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 300, 41.5);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 15, -60);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 0, 'S2');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 1, 'S2');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'A', 315, 18.5, 'S2');
        HX094AssertNoNegative(Lines, 'S2');
        HX094AssertHeader(Header, InvoiceNo, 315, 0, 18.5, 333.5, 'S2');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario03()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('03', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 300, 60);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 15, -41.5);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 1, 'S3');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 0, 'S3');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', 'A', 315, 18.5, 'S3');
        HX094AssertNoNegative(Lines, 'S3');
        HX094AssertHeader(Header, InvoiceNo, 315, 18.5, 0, 296.5, 'S3');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario04()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('04', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'B', 100, 5);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 200, 20);
        HX094InvoiceLine(InvoiceNo, 30000, 'B', 50, -20);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 1, 'S4');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 1, 'S4');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', 'A', 200, 20, 'S4');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'B', 150, 15, 'S4');
        HX094AssertNoNegative(Lines, 'S4');
        HX094AssertHeader(Header, InvoiceNo, 350, 20, 15, 345, 'S4');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario05()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('05', 25);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, -10);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 0, 'S5');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 2, 'S5');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'FEE', '', 0, 25, 'S5');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'A', 100, 10, 'S5');
        HX094AssertNoNegative(Lines, 'S5');
        HX094AssertHeader(Header, InvoiceNo, 100, 0, 35, 135, 'S5');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario06()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('06', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, 10);
        HX094InvoiceLine(InvoiceNo, 20000, 'B', 80, 8);
        HX094InvoiceLine(InvoiceNo, 30000, 'A', 100, -10);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 1, 'S6');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 0, 'S6');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', 'B', 80, 8, 'S6');
        HX094AssertNoNegative(Lines, 'S6');
        HX094AssertHeader(Header, InvoiceNo, 280, 8, 0, 272, 'S6');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario07()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('07', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, 5);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 100, 7);
        HX094InvoiceLine(InvoiceNo, 30000, 'A', 50, 0);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 1, 'S7');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 0, 'S7');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', 'A', 250, 12, 'S7');
        HX094AssertNoNegative(Lines, 'S7');
        HX094AssertHeader(Header, InvoiceNo, 250, 12, 0, 238, 'S7');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario08()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('08', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'B', 100, 4);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 100, 10);
        HX094InvoiceLine(InvoiceNo, 30000, 'B', 60, 0);
        HX094InvoiceLine(InvoiceNo, 40000, 'B', 40, -9);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 1, 'S8');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 1, 'S8');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Discount, 'DISC', 'A', 100, 10, 'S8');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'B', 200, 5, 'S8');
        HX094AssertNoNegative(Lines, 'S8');
        HX094AssertHeader(Header, InvoiceNo, 300, 10, 5, 295, 'S8');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario09()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('09', 0);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, -3);
        HX094InvoiceLine(InvoiceNo, 20000, 'A', 50, -2);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 0, 'S9');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 1, 'S9');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'A', 150, 5, 'S9');
        HX094AssertNoNegative(Lines, 'S9');
        HX094AssertHeader(Header, InvoiceNo, 150, 0, 5, 155, 'S9');
        HX094Cleanup(InvoiceNo);
    end;

    [Test]
    procedure Scenario10()
    var
        Header: Record "CGR Invoice Summary Header" temporary;
        Lines: Record "CGR Invoice Summary Line" temporary;
        InvoiceNo: Code[20];
    begin
        InvoiceNo := HX094Invoice('10', 5);
        HX094InvoiceLine(InvoiceNo, 10000, 'A', 100, -10);
        HX094InvoiceLine(InvoiceNo, 20000, 'B', 100, -20);

        HX094Build(InvoiceNo, Header, Lines);

        HX094AssertCount(Lines, "CGR Summary Line Type"::Discount, 0, 'S10');
        HX094AssertCount(Lines, "CGR Summary Line Type"::Charge, 3, 'S10');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'A', 100, 10, 'S10');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'DISC-ADJ', 'B', 100, 20, 'S10');
        HX094AssertLine(Lines, "CGR Summary Line Type"::Charge, 'FEE', '', 0, 5, 'S10');
        HX094AssertNoNegative(Lines, 'S10');
        HX094AssertHeader(Header, InvoiceNo, 200, 0, 35, 235, 'S10');
        HX094Cleanup(InvoiceNo);
    end;

    local procedure HX094Invoice(Tag: Text[2]; HandlingFee: Decimal): Code[20]
    var
        Invoice: Record "CGR Rental Invoice";
    begin
        Invoice.Init();
        Invoice."No." := CopyStr('HX094-' + Tag + '-' + CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 8), 1, MaxStrLen(Invoice."No."));
        Invoice."Customer Name" := 'HX094 Customer';
        Invoice."Handling Fee" := HandlingFee;
        Invoice.Insert();
        exit(Invoice."No.");
    end;

    local procedure HX094InvoiceLine(InvoiceNo: Code[20]; LineNo: Integer; TaxGroupCode: Code[10]; LineAmount: Decimal; DiscountAmount: Decimal)
    var
        InvoiceLine: Record "CGR Rental Invoice Line";
    begin
        InvoiceLine.Init();
        InvoiceLine."Invoice No." := InvoiceNo;
        InvoiceLine."Line No." := LineNo;
        InvoiceLine.Description := 'HX094 line';
        InvoiceLine."Tax Group Code" := TaxGroupCode;
        InvoiceLine."Line Amount" := LineAmount;
        InvoiceLine."Discount Amount" := DiscountAmount;
        InvoiceLine.Insert();
    end;

    local procedure HX094Build(InvoiceNo: Code[20]; var Header: Record "CGR Invoice Summary Header" temporary; var Lines: Record "CGR Invoice Summary Line" temporary)
    var
        InvoiceSummary: Codeunit "CGR Invoice Summary";
    begin
        InvoiceSummary.Build(InvoiceNo, Header, Lines);
    end;

    local procedure HX094AssertCount(var Lines: Record "CGR Invoice Summary Line" temporary; LineType: Enum "CGR Summary Line Type"; Expected: Integer; Scenario: Text)
    begin
        Lines.Reset();
        Lines.SetRange("Line Type", LineType);
        Assert.AreEqual(Expected, Lines.Count(), StrSubstNo('%1: number of %2 lines', Scenario, LineType));
        Lines.Reset();
    end;

    local procedure HX094AssertLine(var Lines: Record "CGR Invoice Summary Line" temporary; LineType: Enum "CGR Summary Line Type"; ReasonCode: Code[10]; TaxGroupCode: Code[10]; ExpectedBase: Decimal; ExpectedAmount: Decimal; Scenario: Text)
    var
        What: Text;
    begin
        What := StrSubstNo('%1: %2 line %3 for tax group ''%4''', Scenario, LineType, ReasonCode, TaxGroupCode);
        Lines.Reset();
        Lines.SetRange("Line Type", LineType);
        Lines.SetRange("Reason Code", ReasonCode);
        Lines.SetRange("Tax Group Code", TaxGroupCode);
        Assert.AreEqual(1, Lines.Count(), What + ': exactly one line');
        if Lines.FindFirst() then begin
            Assert.AreEqual(ExpectedBase, Lines."Base Amount", What + ': Base Amount');
            Assert.AreEqual(ExpectedAmount, Lines.Amount, What + ': Amount');
        end;
        Lines.Reset();
    end;

    local procedure HX094AssertNoNegative(var Lines: Record "CGR Invoice Summary Line" temporary; Scenario: Text)
    begin
        Lines.Reset();
        Lines.SetFilter(Amount, '<0');
        Assert.AreEqual(0, Lines.Count(), Scenario + ': no summary line has a negative Amount');
        Lines.Reset();
        Lines.SetFilter("Base Amount", '<0');
        Assert.AreEqual(0, Lines.Count(), Scenario + ': no summary line has a negative Base Amount');
        Lines.Reset();
    end;

    local procedure HX094AssertHeader(var Header: Record "CGR Invoice Summary Header" temporary; InvoiceNo: Code[20]; LineTotal: Decimal; DiscountTotal: Decimal; ChargeTotal: Decimal; TotalExclTax: Decimal; Scenario: Text)
    begin
        Header.Reset();
        Assert.AreEqual(1, Header.Count(), Scenario + ': one header');
        if not Header.Get(InvoiceNo) then
            Assert.Fail(Scenario + ': the header is for the invoice');
        Assert.AreEqual(LineTotal, Header."Line Total", Scenario + ': Line Total');
        Assert.AreEqual(DiscountTotal, Header."Discount Total", Scenario + ': Discount Total');
        Assert.AreEqual(ChargeTotal, Header."Charge Total", Scenario + ': Charge Total');
        Assert.AreEqual(TotalExclTax, Header."Total Excl. Tax", Scenario + ': Total Excl. Tax');
        Assert.AreEqual(TotalExclTax, Header."Line Total" - Header."Discount Total" + Header."Charge Total", Scenario + ': Line Total - Discount Total + Charge Total = Total Excl. Tax');
    end;

    local procedure HX094Cleanup(InvoiceNo: Code[20])
    var
        Invoice: Record "CGR Rental Invoice";
        InvoiceLine: Record "CGR Rental Invoice Line";
    begin
        InvoiceLine.SetRange("Invoice No.", InvoiceNo);
        InvoiceLine.DeleteAll();
        if Invoice.Get(InvoiceNo) then
            Invoice.Delete();
    end;
}
