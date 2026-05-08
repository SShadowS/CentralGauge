codeunit 80103 "CG-AL-H027 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibrarySales: Codeunit "Library - Sales";

    [Test]
    procedure TestWatchedFieldChangedFiresOnce()
    var
        Customer: Record Customer;
        Counter: Codeunit "CG H027 Change Counter";
    begin
        // [SCENARIO] A modification that transitions "CG H027 Watched" to a new value
        // must increment the counter exactly once.
        LibrarySales.CreateCustomer(Customer);
        Customer."CG H027 Watched" := 'ALPHA';
        Customer.Modify();

        Counter.Reset();
        Assert.AreEqual(0, Counter.GetCount(), 'Counter must be zero after Reset');

        Customer.Get(Customer."No.");
        Customer."CG H027 Watched" := 'BETA';
        Customer.Modify();

        Assert.AreEqual(1, Counter.GetCount(), 'Counter must be 1 after a modification that changes the watched field');
    end;

    [Test]
    procedure TestUnrelatedFieldChangeDoesNotFire()
    var
        Customer: Record Customer;
        Counter: Codeunit "CG H027 Change Counter";
    begin
        // [SCENARIO] A modification that leaves "CG H027 Watched" untouched must not
        // increment the counter, even though the modification itself happened.
        LibrarySales.CreateCustomer(Customer);
        Customer."CG H027 Watched" := 'GAMMA';
        Customer.Modify();

        Counter.Reset();
        Assert.AreEqual(0, Counter.GetCount(), 'Counter must be zero after Reset');

        Customer.Get(Customer."No.");
        Customer.Address := 'Some New Street 1';
        Customer.Modify();

        Assert.AreEqual(0, Counter.GetCount(), 'Counter must remain 0 when only an unrelated base field changes');
    end;

    [Test]
    procedure TestTwoConsecutiveChangesFireTwice()
    var
        Customer: Record Customer;
        Counter: Codeunit "CG H027 Change Counter";
    begin
        // [SCENARIO] Two consecutive modifications that each change "CG H027 Watched"
        // to a new distinct value must increment the counter exactly twice in total.
        LibrarySales.CreateCustomer(Customer);
        Customer."CG H027 Watched" := '';
        Customer.Modify();

        Counter.Reset();
        Assert.AreEqual(0, Counter.GetCount(), 'Counter must be zero after Reset');

        Customer.Get(Customer."No.");
        Customer."CG H027 Watched" := 'ALPHA';
        Customer.Modify();
        Assert.AreEqual(1, Counter.GetCount(), 'Counter must be 1 after first watched-field change');

        Customer.Get(Customer."No.");
        Customer."CG H027 Watched" := 'BETA';
        Customer.Modify();
        Assert.AreEqual(2, Counter.GetCount(), 'Counter must be 2 after second watched-field change');
    end;

    [Test]
    procedure TestReassignSameValueDoesNotFire()
    var
        Customer: Record Customer;
        Counter: Codeunit "CG H027 Change Counter";
    begin
        // [SCENARIO] Writing the same value back to "CG H027 Watched" must not
        // increment the counter, because the persisted value did not transition.
        LibrarySales.CreateCustomer(Customer);
        Customer."CG H027 Watched" := 'STABLE';
        Customer.Modify();

        Counter.Reset();
        Assert.AreEqual(0, Counter.GetCount(), 'Counter must be zero after Reset');

        Customer.Get(Customer."No.");
        Customer."CG H027 Watched" := 'STABLE';
        Customer.Modify();

        Assert.AreEqual(0, Counter.GetCount(), 'Counter must remain 0 when watched field is reassigned to its current value');
    end;
}
