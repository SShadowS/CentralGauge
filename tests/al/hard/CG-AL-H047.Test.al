codeunit 80262 "CG-AL-H047 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestDistinctCountAcrossAllSeededRows()
    var
        OrderLine: Record "CG H047 Order Line";
        DistinctCustomers: Codeunit "CG H047 Distinct Customers";
    begin
        // Seeded data has 6 rows across 3 distinct customers (C001 x3, C002 x2, C003 x1).
        Assert.AreEqual(3, DistinctCustomers.DistinctCount(OrderLine), 'Distinct customer count must be 3.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestDistinctCountWithFilterToSingleCustomer()
    var
        OrderLine: Record "CG H047 Order Line";
        DistinctCustomers: Codeunit "CG H047 Distinct Customers";
    begin
        OrderLine.SetRange("Customer No.", 'C001');
        Assert.AreEqual(1, DistinctCustomers.DistinctCount(OrderLine), 'Filtered to C001-only must report 1 distinct customer.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestDistinctCountWithEmptyFilter()
    var
        OrderLine: Record "CG H047 Order Line";
        DistinctCustomers: Codeunit "CG H047 Distinct Customers";
    begin
        OrderLine.SetRange("Customer No.", 'NO-SUCH-CUSTOMER');
        Assert.AreEqual(0, DistinctCustomers.DistinctCount(OrderLine), 'Empty filter set must report 0 distinct customers.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestDistinctCountIgnoresDuplicates()
    var
        OrderLine: Record "CG H047 Order Line";
        DistinctCustomers: Codeunit "CG H047 Distinct Customers";
    begin
        // Filter to lines 1, 3, 6 (all C001) - 3 rows but only 1 distinct customer.
        OrderLine.SetFilter("Line No.", '1|3|6');
        Assert.AreEqual(1, DistinctCustomers.DistinctCount(OrderLine), '3 duplicate-customer rows must collapse to 1 distinct.');
    end;
}
