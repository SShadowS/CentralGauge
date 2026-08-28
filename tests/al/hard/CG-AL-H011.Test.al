using Microsoft.Sales.Document;

codeunit 80012 "CG-AL-H011 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Every row this oracle seeds carries the CGH011 document-number prefix, so
    // the queries below filter to it and the assertions are unaffected by the
    // Sales Lines the demo company already ships.

    var
        Assert: Codeunit Assert;
        DocFilterTok: Label 'CGH011*', Locked = true;

    local procedure Reset()
    var
        SalesLine: Record "Sales Line";
    begin
        SalesLine.SetFilter("Document No.", DocFilterTok);
        SalesLine.DeleteAll(false);
    end;

    local procedure Seed(DocType: Enum "Sales Document Type"; DocNo: Code[20]; LineNo: Integer; CustomerNo: Code[20]; Amount: Decimal)
    var
        SalesLine: Record "Sales Line";
    begin
        SalesLine.Init();
        SalesLine."Document Type" := DocType;
        SalesLine."Document No." := DocNo;
        SalesLine."Line No." := LineNo;
        SalesLine."Sell-to Customer No." := CustomerNo;
        SalesLine."Line Amount" := Amount;
        SalesLine.Insert(false);
    end;

    [Test]
    procedure LineAmountsAreSummedPerDocument()
    var
        SalesSummary: Query "CG Sales Summary";
    begin
        // [SCENARIO] Three order lines on one document collapse into one row
        Reset();
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-A', 10000, 'CGH011-C1', 100.5);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-A', 20000, 'CGH011-C1', 200.25);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-A', 30000, 'CGH011-C1', 300.25);

        SalesSummary.SetRange(Document_No, 'CGH011-A');
        SalesSummary.Open();

        Assert.IsTrue(SalesSummary.Read(), 'Expected the query to return a row for a document with order lines');
        Assert.AreEqual(601.0, SalesSummary.Line_Amount_Sum, 'Expected Line_Amount_Sum to total every line on the document');
        Assert.AreEqual('CGH011-C1', SalesSummary.Sell_to_Customer_No, 'Expected the grouped row to carry its document''s customer');
        Assert.IsFalse(SalesSummary.Read(), 'Expected three lines on one document to aggregate into a single row, not three');

        SalesSummary.Close();
    end;

    [Test]
    procedure LineCountCountsLinesNotDocuments()
    var
        SalesSummary: Query "CG Sales Summary";
    begin
        // [SCENARIO] Method = Count counts the rows behind the group
        Reset();
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-B', 10000, 'CGH011-C1', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-B', 20000, 'CGH011-C1', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-B', 30000, 'CGH011-C1', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-B', 40000, 'CGH011-C1', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-B', 50000, 'CGH011-C1', 10);

        SalesSummary.SetRange(Document_No, 'CGH011-B');
        SalesSummary.Open();

        Assert.IsTrue(SalesSummary.Read(), 'Expected a row for the seeded document');
        Assert.AreEqual(5, SalesSummary.Line_Count, 'Expected Line_Count to count the five lines behind the group, not the one document');

        SalesSummary.Close();
    end;

    [Test]
    procedure NonOrderDocumentsAreFilteredOut()
    var
        SalesSummary: Query "CG Sales Summary";
    begin
        // [SCENARIO] The Document Type filter element restricts the query to orders
        Reset();
        Seed(Enum::"Sales Document Type"::Invoice, 'CGH011-C', 10000, 'CGH011-C2', 999);
        Seed(Enum::"Sales Document Type"::"Credit Memo", 'CGH011-C', 20000, 'CGH011-C2', 888);

        SalesSummary.SetRange(Document_No, 'CGH011-C');
        SalesSummary.Open();

        Assert.IsFalse(SalesSummary.Read(), 'Expected a document with no order lines to be excluded by the Document Type filter');

        SalesSummary.Close();
    end;

    [Test]
    procedure OrderLinesAreSummedWithoutTheirNonOrderNamesakes()
    var
        SalesSummary: Query "CG Sales Summary";
    begin
        // [SCENARIO] Same document number, two document types - only the order half counts
        Reset();
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-D', 10000, 'CGH011-C3', 50);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-D', 20000, 'CGH011-C3', 70);
        Seed(Enum::"Sales Document Type"::Invoice, 'CGH011-D', 30000, 'CGH011-C3', 10000);

        SalesSummary.SetRange(Document_No, 'CGH011-D');
        SalesSummary.Open();

        Assert.IsTrue(SalesSummary.Read(), 'Expected a row for the order half of the document');
        Assert.AreEqual(120.0, SalesSummary.Line_Amount_Sum, 'Expected only the order lines to be summed, excluding the invoice line sharing the document number');
        Assert.AreEqual(2, SalesSummary.Line_Count, 'Expected only the two order lines to be counted');

        SalesSummary.Close();
    end;

    [Test]
    procedure EachDocumentFormsItsOwnGroup()
    var
        SalesSummary: Query "CG Sales Summary";
        SeenE: Boolean;
        SeenF: Boolean;
        Rows: Integer;
    begin
        // [SCENARIO] Grouping is per document, not one row for the whole set
        Reset();
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-E', 10000, 'CGH011-C4', 25);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-E', 20000, 'CGH011-C4', 25);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-F', 10000, 'CGH011-C5', 400);

        SalesSummary.SetFilter(Document_No, 'CGH011-E|CGH011-F');
        SalesSummary.Open();

        while SalesSummary.Read() do begin
            Rows += 1;
            case SalesSummary.Document_No of
                'CGH011-E':
                    begin
                        SeenE := true;
                        Assert.AreEqual(50.0, SalesSummary.Line_Amount_Sum, 'Expected the first document to sum only its own two lines');
                    end;
                'CGH011-F':
                    begin
                        SeenF := true;
                        Assert.AreEqual(400.0, SalesSummary.Line_Amount_Sum, 'Expected the second document to sum only its own line');
                    end;
            end;
        end;
        SalesSummary.Close();

        Assert.AreEqual(2, Rows, 'Expected one row per document, not a single combined row');
        Assert.IsTrue(SeenE, 'Expected the first document to appear in the result');
        Assert.IsTrue(SeenF, 'Expected the second document to appear in the result');
    end;

    [Test]
    procedure ResultsAreOrderedBySellToCustomerNoAscending()
    var
        SalesSummary: Query "CG Sales Summary";
        Previous: Code[20];
        Rows: Integer;
    begin
        // [SCENARIO] Documents are seeded customer-descending; the query must
        // hand them back ascending
        Reset();
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-G3', 10000, 'CGH011-C9', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-G1', 10000, 'CGH011-C7', 10);
        Seed(Enum::"Sales Document Type"::Order, 'CGH011-G2', 10000, 'CGH011-C8', 10);

        SalesSummary.SetFilter(Document_No, 'CGH011-G*');
        SalesSummary.Open();

        while SalesSummary.Read() do begin
            Rows += 1;
            Assert.IsTrue(
                SalesSummary.Sell_to_Customer_No >= Previous,
                StrSubstNo('Expected rows ordered by "Sell-to Customer No." ascending, but %1 followed %2', SalesSummary.Sell_to_Customer_No, Previous));
            Previous := SalesSummary.Sell_to_Customer_No;
        end;
        SalesSummary.Close();

        Assert.AreEqual(3, Rows, 'Expected all three seeded documents in the result');
        Assert.AreEqual('CGH011-C9', Previous, 'Expected the highest customer number last under an ascending order');
    end;
}
