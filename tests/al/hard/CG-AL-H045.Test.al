codeunit 80260 "CG-AL-H045 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestMatchingRowsUpdated()
    var
        Entry: Record "CG H045 Entry";
        Tol: Codeunit "CG H045 Tolerance";
    begin
        Tol.ApplyTolerance('D1', 12.5);

        Entry.SetRange("Doc No.", 'D1');
        Entry.FindSet();
        repeat
            Assert.AreEqual(12.5, Entry.Tolerance, 'D1 row Tolerance must be 12.5.');
            Assert.IsFalse(Entry."Accepted Flag", 'D1 row Accepted Flag must be false.');
        until Entry.Next() = 0;

        Assert.AreEqual(3, Entry.Count, 'D1 still has 3 rows.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestNonMatchingRowsUntouched()
    var
        Entry: Record "CG H045 Entry";
        Tol: Codeunit "CG H045 Tolerance";
    begin
        Tol.ApplyTolerance('D1', 12.5);

        Entry.SetRange("Doc No.", 'D2');
        Entry.FindSet();
        repeat
            Assert.AreEqual(5, Entry.Tolerance, 'D2 row Tolerance must remain 5.');
            Assert.IsTrue(Entry."Accepted Flag", 'D2 row Accepted Flag must remain true.');
        until Entry.Next() = 0;

        Assert.AreEqual(2, Entry.Count, 'D2 still has 2 rows.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestRowCountUnchanged()
    var
        Entry: Record "CG H045 Entry";
        Tol: Codeunit "CG H045 Tolerance";
    begin
        Tol.ApplyTolerance('D1', 99);
        Assert.AreEqual(5, Entry.Count, 'Total row count must not change.');
    end;

    [Test]
    [TransactionModel(TransactionModel::AutoRollback)]
    procedure TestZeroTolerance()
    var
        Entry: Record "CG H045 Entry";
        Tol: Codeunit "CG H045 Tolerance";
    begin
        // Zero is a valid value; flag must still flip on every D1 row.
        Tol.ApplyTolerance('D1', 0);

        Entry.SetRange("Doc No.", 'D1');
        Entry.FindSet();
        repeat
            Assert.AreEqual(0, Entry.Tolerance, 'D1 row Tolerance must be 0.');
            Assert.IsFalse(Entry."Accepted Flag", 'D1 row Accepted Flag must be false.');
        until Entry.Next() = 0;
    end;
}
