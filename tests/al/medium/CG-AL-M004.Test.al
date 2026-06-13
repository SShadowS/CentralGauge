codeunit 80014 "CG-AL-M004 Test"
{
    // Tests for CG-AL-M004: Interactive Page - Sales Order Workspace
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibrarySales: Codeunit "Library - Sales";

    [Test]
    procedure TestPageOpens()
    var
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] Sales Order Workspace page opens
        // [WHEN] We open the page
        SalesOrderWorkspace.OpenView();
        // [THEN] No error occurs
        SalesOrderWorkspace.Close();
    end;

    [Test]
    procedure TestGeneralFastTabFields()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] General FastTab displays all required fields
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We open the page and navigate to the record
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] All General FastTab fields are visible and correct
        SalesOrderWorkspace."No.".AssertEquals(SalesHeader."No.");
        SalesOrderWorkspace."Sell-to Customer No.".AssertEquals(SalesHeader."Sell-to Customer No.");
        SalesOrderWorkspace."Sell-to Customer Name".AssertEquals(SalesHeader."Sell-to Customer Name");
        SalesOrderWorkspace."Order Date".AssertEquals(SalesHeader."Order Date");
        SalesOrderWorkspace."Posting Date".AssertEquals(SalesHeader."Posting Date");
        SalesOrderWorkspace.Status.AssertEquals(SalesHeader.Status);

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestFinancialFastTabFields()
    var
        SalesHeader: Record "Sales Header";
        SalesLine: Record "Sales Line";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] Financial FastTab displays amount fields correctly
        // [GIVEN] A sales order with lines that have amounts
        CreateSalesOrderWithLine(SalesHeader, SalesLine);

        // [WHEN] We open the page and navigate to the record
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] Financial FastTab amount fields are accessible
        Assert.IsTrue(SalesOrderWorkspace.Amount.Visible(), 'Amount field should be visible');
        Assert.IsTrue(SalesOrderWorkspace."Amount Including VAT".Visible(), 'Amount Including VAT field should be visible');

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestCalculateTotalsActionInvoke()
    var
        SalesHeader: Record "Sales Header";
        SalesLine: Record "Sales Line";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] CalculateTotals action can be invoked and triggers CALCFIELDS
        // [GIVEN] A sales order with lines
        CreateSalesOrderWithLine(SalesHeader, SalesLine);

        // [WHEN] We invoke the CalculateTotals action
        SalesOrderWorkspace.OpenEdit();
        SalesOrderWorkspace.GoToRecord(SalesHeader);
        SalesOrderWorkspace.CalculateTotals.Invoke();

        // [THEN] Action completes without error (MESSAGE is displayed to user)
        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestApplyDiscountActionExists()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] ApplyDiscount action exists and is visible
        // Note: Cannot test invocation as DIALOG requires user input
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We open the page
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] ApplyDiscount action is visible and enabled for open orders
        Assert.IsTrue(SalesOrderWorkspace.ApplyDiscount.Visible(), 'ApplyDiscount action should be visible');
        Assert.IsTrue(SalesOrderWorkspace.ApplyDiscount.Enabled(), 'ApplyDiscount action should be enabled for open orders');

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestExportPDFActionInvoke()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] ExportPDF action can be invoked
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We invoke the ExportPDF action
        SalesOrderWorkspace.OpenEdit();
        SalesOrderWorkspace.GoToRecord(SalesHeader);
        SalesOrderWorkspace.ExportPDF.Invoke();

        // [THEN] Action completes without error (MESSAGE indicates PDF would be generated)
        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestSendEmailActionInvoke()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] SendEmail action can be invoked
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We invoke the SendEmail action
        SalesOrderWorkspace.OpenEdit();
        SalesOrderWorkspace.GoToRecord(SalesHeader);
        SalesOrderWorkspace.SendEmail.Invoke();

        // [THEN] Action completes without error (MESSAGE indicates email would be sent)
        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestActionsEnabledWhenOpen()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] CalculateTotals and ApplyDiscount are enabled when Status is Open
        // [GIVEN] A sales order with Status = Open
        CreateSalesOrder(SalesHeader);
        SalesHeader.Status := SalesHeader.Status::Open;
        SalesHeader.Modify();

        // [WHEN] We open the page
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] CalculateTotals and ApplyDiscount actions are enabled
        Assert.IsTrue(SalesOrderWorkspace.CalculateTotals.Enabled(), 'CalculateTotals should be enabled when Status is Open');
        Assert.IsTrue(SalesOrderWorkspace.ApplyDiscount.Enabled(), 'ApplyDiscount should be enabled when Status is Open');

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestActionsDisabledWhenReleased()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] CalculateTotals and ApplyDiscount are disabled when Status is Released
        // [GIVEN] A sales order with Status = Released
        CreateSalesOrder(SalesHeader);
        SalesHeader.Status := SalesHeader.Status::Released;
        SalesHeader.Modify();

        // [WHEN] We open the page
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] CalculateTotals and ApplyDiscount actions are disabled
        Assert.IsFalse(SalesOrderWorkspace.CalculateTotals.Enabled(), 'CalculateTotals should be disabled when Status is Released');
        Assert.IsFalse(SalesOrderWorkspace.ApplyDiscount.Enabled(), 'ApplyDiscount should be disabled when Status is Released');

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Status := SalesHeader.Status::Open;
        SalesHeader.Modify();
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestLinesSubpageDisplaysSalesLines()
    var
        SalesHeader: Record "Sales Header";
        SalesLine: Record "Sales Line";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] Lines subpage displays the sales lines for the order
        // [GIVEN] A sales order with a line
        CreateSalesOrderWithLine(SalesHeader, SalesLine);

        // [WHEN] We open the page and view the lines subpage
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] The lines subpage shows the sales line data
        SalesOrderWorkspace.Lines.First();
        SalesOrderWorkspace.Lines."No.".AssertEquals(SalesLine."No.");
        SalesOrderWorkspace.Lines.Quantity.AssertEquals(SalesLine.Quantity);

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestActionsHaveApplicationAreaAll()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] All custom actions are visible (ApplicationArea = All)
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We open the page
        SalesOrderWorkspace.OpenView();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] All custom actions are visible
        Assert.IsTrue(SalesOrderWorkspace.CalculateTotals.Visible(), 'CalculateTotals action should be visible');
        Assert.IsTrue(SalesOrderWorkspace.ApplyDiscount.Visible(), 'ApplyDiscount action should be visible');
        Assert.IsTrue(SalesOrderWorkspace.ExportPDF.Visible(), 'ExportPDF action should be visible');
        Assert.IsTrue(SalesOrderWorkspace.SendEmail.Visible(), 'SendEmail action should be visible');

        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    [Test]
    procedure TestPageTypeIsCard()
    var
        SalesHeader: Record "Sales Header";
        SalesOrderWorkspace: TestPage "Sales Order Workspace";
    begin
        // [SCENARIO] Page is of type Card (can open a single record)
        // [GIVEN] A sales order
        CreateSalesOrder(SalesHeader);

        // [WHEN] We open the page for a specific record
        SalesOrderWorkspace.OpenEdit();
        SalesOrderWorkspace.GoToRecord(SalesHeader);

        // [THEN] We can edit the record (Card page behavior)
        SalesOrderWorkspace."Posting Date".SetValue(LicenseSafeDate());
        SalesOrderWorkspace.Close();

        // Cleanup
        SalesHeader.Delete(true);
    end;

    local procedure CreateSalesOrder(var SalesHeader: Record "Sales Header")
    var
        Customer: Record Customer;
    begin
        LibrarySales.CreateCustomer(Customer);
        LibrarySales.CreateSalesHeader(SalesHeader, SalesHeader."Document Type"::Order, Customer."No.");
    end;

    local procedure CreateSalesOrderWithLine(var SalesHeader: Record "Sales Header"; var SalesLine: Record "Sales Line")
    var
        Item: Record Item;
        LibraryInventory: Codeunit "Library - Inventory";
    begin
        CreateSalesOrder(SalesHeader);
        LibraryInventory.CreateItem(Item);
        LibrarySales.CreateSalesLine(SalesLine, SalesHeader, SalesLine.Type::Item, Item."No.", 10);
        SalesLine.Validate("Unit Price", 100);
        SalesLine.Modify();
    end;

    [MessageHandler]
    procedure MessageHandler(Message: Text[1024])
    begin
        // Handle any MESSAGE calls from actions
        // MESSAGE is expected for CalculateTotals, ExportPDF, and SendEmail actions
    end;

    local procedure LicenseSafeDate(): Date
    begin
        // The Cronus demo license restricts dates entered through the client to
        // the Nov-Feb window (filter '??11*|??12*|??01*|??02*'). A date set
        // through a TestPage outside that window is rejected by the client-layer
        // license check, so setting Posting Date through the page must use an
        // in-window date to stay portable across container licenses (GH #13).
        // 15 January of the work-date year is always in-window.
        exit(DMY2Date(15, 1, Date2DMY(WorkDate(), 3)));
    end;
}
