codeunit 88824 "CG-AL-X071 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the tables
    // before seeding its own rows.

    local procedure ClearAll()
    var
        Order: Record "CG X071 Order";
        OrderLine: Record "CG X071 Order Line";
        Customer: Record "CG X071 Customer";
    begin
        Order.DeleteAll();
        OrderLine.DeleteAll();
        Customer.DeleteAll();
    end;

    local procedure SeedCustomer(No: Code[20]; Cap: Decimal)
    var
        Customer: Record "CG X071 Customer";
    begin
        Customer.Init();
        Customer."No." := No;
        Customer."Max Order Amount (LCY)" := Cap;
        Customer.Insert();
    end;

    local procedure SeedOrder(No: Code[20]; DocType: Enum "CG X071 Order Doc Type"; SellToNo: Code[20]; BillToNo: Code[20])
    var
        Order: Record "CG X071 Order";
    begin
        Order.Init();
        Order."No." := No;
        Order."Document Type" := DocType;
        Order."Sell-to Customer No." := SellToNo;
        Order."Bill-to Customer No." := BillToNo;
        Order.Insert();
    end;

    local procedure SeedReleasedOrder(No: Code[20]; DocType: Enum "CG X071 Order Doc Type"; SellToNo: Code[20]; BillToNo: Code[20])
    var
        Order: Record "CG X071 Order";
    begin
        Order.Init();
        Order."No." := No;
        Order."Document Type" := DocType;
        Order."Sell-to Customer No." := SellToNo;
        Order."Bill-to Customer No." := BillToNo;
        Order.Status := Order.Status::Released;
        Order.Insert();
    end;

    local procedure SeedOrderLine(OrderNo: Code[20]; LineNo: Integer; Amount: Decimal)
    var
        OrderLine: Record "CG X071 Order Line";
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine.Amount := Amount;
        OrderLine.Insert();
    end;

    local procedure OrderIsReleased(No: Code[20]): Boolean
    var
        Order: Record "CG X071 Order";
    begin
        Order.Get(No);
        exit(Order.Status = Order.Status::Released);
    end;

    [Test]
    procedure OverCapOrderIsBlockedAndStaysOpen()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] Releasing an order whose amount exceeds the customer's cap fails and leaves the order unreleased
        ClearAll();
        SeedCustomer('C1', 100);
        SeedOrder('O1', Enum::"CG X071 Order Doc Type"::Order, 'C1', 'C1');
        SeedOrderLine('O1', 1, 90);
        SeedOrderLine('O1', 2, 60);
        Commit();

        Order.Get('O1');
        asserterror ReleaseMgt.Release(Order);

        Assert.ExpectedError('Max Order Amount (LCY)');
        Assert.IsFalse(OrderIsReleased('O1'), 'An order above its customer''s cap must not release');
    end;

    [Test]
    procedure UnderCapOrderReleases()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] An order below the customer's cap releases normally
        ClearAll();
        SeedCustomer('C2', 100);
        SeedOrder('O2', Enum::"CG X071 Order Doc Type"::Order, 'C2', 'C2');
        SeedOrderLine('O2', 1, 40);

        Order.Get('O2');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O2'), 'An order below its customer''s cap must release');
    end;

    [Test]
    procedure OrderExactlyAtCapReleases()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] An order whose amount equals the cap exactly is not over the cap
        ClearAll();
        SeedCustomer('C3', 100);
        SeedOrder('O3', Enum::"CG X071 Order Doc Type"::Order, 'C3', 'C3');
        SeedOrderLine('O3', 1, 100);

        Order.Get('O3');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O3'), 'An order whose amount equals the cap exactly must still release');
    end;

    [Test]
    procedure ZeroCapMeansNoLimit()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] A cap of 0 means the customer has no order cap at all
        ClearAll();
        SeedCustomer('C4', 0);
        SeedOrder('O4', Enum::"CG X071 Order Doc Type"::Order, 'C4', 'C4');
        SeedOrderLine('O4', 1, 50000);

        Order.Get('O4');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O4'), 'A customer with no configured cap must have no limit on order amount');
    end;

    [Test]
    procedure OverCapInvoiceStillReleases()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] The cap governs orders only - an invoice document above the cap still releases
        ClearAll();
        SeedCustomer('C5', 100);
        SeedOrder('O5', Enum::"CG X071 Order Doc Type"::Invoice, 'C5', 'C5');
        SeedOrderLine('O5', 1, 150);

        Order.Get('O5');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O5'), 'A non-order document above the cap must still release');
    end;

    [Test]
    procedure OverCapQuoteStillReleases()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] The cap governs orders only - a quote above the cap still releases
        ClearAll();
        SeedCustomer('C6', 100);
        SeedOrder('O6', Enum::"CG X071 Order Doc Type"::Quote, 'C6', 'C6');
        SeedOrderLine('O6', 1, 150);

        Order.Get('O6');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O6'), 'A non-order document above the cap must still release');
    end;

    [Test]
    procedure CapAppliesFromSellToCustomerNotBillTo()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] The cap comes from the sell-to customer, not the bill-to customer
        ClearAll();
        SeedCustomer('SELL7', 100);
        SeedCustomer('BILL7', 0);
        SeedOrder('O7', Enum::"CG X071 Order Doc Type"::Order, 'SELL7', 'BILL7');
        SeedOrderLine('O7', 1, 150);
        Commit();

        Order.Get('O7');
        asserterror ReleaseMgt.Release(Order);

        Assert.ExpectedError('Max Order Amount (LCY)');
        Assert.IsFalse(OrderIsReleased('O7'),
            'The order must be blocked by the sell-to customer''s cap even though the bill-to customer has none');
    end;

    [Test]
    procedure AnotherOrdersLinesDoNotAffectThisOrdersRelease()
    var
        Order: Record "CG X071 Order";
        ReleaseMgt: Codeunit "CG X071 Release Mgt";
    begin
        // [SCENARIO] Only this order's own lines count toward its amount; an
        // already-released order sitting in the same tables with large lines
        // of its own must not be touched or counted.
        ClearAll();
        SeedCustomer('C8', 100);
        SeedReleasedOrder('O8-OTHER', Enum::"CG X071 Order Doc Type"::Order, 'C8', 'C8');
        SeedOrderLine('O8-OTHER', 1, 500);
        SeedOrder('O8-TARGET', Enum::"CG X071 Order Doc Type"::Order, 'C8', 'C8');
        SeedOrderLine('O8-TARGET', 1, 60);

        Order.Get('O8-TARGET');
        ReleaseMgt.Release(Order);

        Assert.IsTrue(OrderIsReleased('O8-TARGET'),
            'An order under its own cap must release even when another order''s lines in the same tables would push a combined total over the cap');
        Assert.IsTrue(OrderIsReleased('O8-OTHER'), 'An unrelated already-released order must remain untouched');
    end;
}
