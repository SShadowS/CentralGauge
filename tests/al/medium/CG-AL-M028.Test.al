codeunit 80028 "CG-AL-M028 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibrarySales: Codeunit "Library - Sales";

    [Test]
    procedure TestSummaryDemoPageOpens()
    var
        Customer: Record Customer;
        SummaryDemoPage: TestPage "CG Customer Summary Demo";
    begin
        LibrarySales.CreateCustomer(Customer);

        SummaryDemoPage.OpenView();
        SummaryDemoPage.GoToRecord(Customer);

        Assert.AreEqual(Customer."No.", SummaryDemoPage."No.".Value, 'Customer No. should be visible on the demo page');

        SummaryDemoPage.Close();

        Customer.Delete();
    end;

    [Test]
    procedure TestSummaryDemoPageNameField()
    var
        Customer: Record Customer;
        SummaryDemoPage: TestPage "CG Customer Summary Demo";
    begin
        LibrarySales.CreateCustomer(Customer);
        Customer.Name := 'M028 Demo Customer';
        Customer.Modify();

        SummaryDemoPage.OpenView();
        SummaryDemoPage.GoToRecord(Customer);

        Assert.AreEqual(Customer.Name, SummaryDemoPage.Name.Value, 'Customer Name should be visible on the demo page');

        SummaryDemoPage.Close();

        Customer.Delete();
    end;

    [Test]
    procedure TestCustomerCardOpensWithExtensionApplied()
    var
        Customer: Record Customer;
        CustomerCard: TestPage "Customer Card";
    begin
        LibrarySales.CreateCustomer(Customer);

        CustomerCard.OpenView();
        CustomerCard.GoToRecord(Customer);

        Assert.AreEqual(Customer."No.", CustomerCard."No.".Value, 'Customer Card should open with the M028 extension applied');

        CustomerCard.Close();

        Customer.Delete();
    end;
}
