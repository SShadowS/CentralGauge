codeunit 80015 "CG-AL-H015 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        PaymentService: Codeunit "Payment Service";

    [Test]
    procedure TestPayPal_Authorized()
    var
        PayPal: Codeunit "PayPal Provider";
        Result: Text;
    begin
        // Amount < 1000 should authorize
        Result := PaymentService.Process(PayPal, 500);
        Assert.AreEqual('Authorized by PayPal', Result, 'PayPal should authorize small amounts');
    end;

    [Test]
    procedure TestPayPal_Declined()
    var
        PayPal: Codeunit "PayPal Provider";
        Result: Text;
    begin
        // Amount >= 1000 should decline
        Result := PaymentService.Process(PayPal, 1500);
        Assert.AreEqual('Declined by PayPal', Result, 'PayPal should decline large amounts');
    end;

    [Test]
    procedure TestPayPal_DeclinedAtLimit()
    var
        PayPal: Codeunit "PayPal Provider";
        Result: Text;
    begin
        // Exactly 1000 is not below the limit. Routed through Payment Service so
        // the interface dispatch is exercised, like the tests either side of it.
        Result := PaymentService.Process(PayPal, 1000);
        Assert.AreEqual('Declined by PayPal', Result, 'PayPal reported an amount of exactly 1000 as authorized');
    end;

    [Test]
    procedure TestCreditCard_AlwaysAuthorized()
    var
        CC: Codeunit "Credit Card Provider";
        Result: Text;
    begin
        // Should authorize even large amounts
        Result := PaymentService.Process(CC, 50000);
        Assert.AreEqual('Authorized by Credit Card', Result, 'Credit Card should always authorize');
    end;

    [Test]
    procedure TestInterfacePolymorphism()
    var
        Gateway: Interface "Payment Gateway";
        PayPal: Codeunit "PayPal Provider";
        Result: Text;
    begin
        // Verify we can assign codeunit to interface variable
        Gateway := PayPal;
        Assert.AreEqual('PayPal', Gateway.GetGatewayName(), 'Interface assignment failed');
    end;
}