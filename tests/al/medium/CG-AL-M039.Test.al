codeunit 80039 "CG-AL-M039 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibrarySales: Codeunit "Library - Sales";

    [Test]
    procedure TestPartVisibleByDefault()
    var
        Customer: Record Customer;
        Card: TestPage "CG TestPart Card";
    begin
        LibrarySales.CreateCustomer(Customer);

        Card.OpenView();
        Card.GoToRecord(Customer);

        Assert.IsTrue(Card.ChildPart.Visible(), 'TestPart.Visible() should return true when the part is visible by default');

        Card.Close();
        Customer.Delete();
    end;

    [Test]
    procedure TestPartEnabledByDefault()
    var
        Customer: Record Customer;
        Card: TestPage "CG TestPart Card";
    begin
        LibrarySales.CreateCustomer(Customer);

        Card.OpenView();
        Card.GoToRecord(Customer);

        Assert.IsTrue(Card.ChildPart.Enabled(), 'TestPart.Enabled() should return true when the part is enabled by default');

        Card.Close();
        Customer.Delete();
    end;
}
