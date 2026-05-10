codeunit 80252 "CG-AL-H037 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestReleasedRowsFlagged()
    var
        Doc: Record "CG H037 Doc";
    begin
        Doc.Get('R1');
        Assert.IsTrue(Doc.Migrated, 'R1 (RELEASED) must have Migrated=true after install.');
        Doc.Get('R2');
        Assert.IsTrue(Doc.Migrated, 'R2 (RELEASED) must have Migrated=true after install.');
    end;

    [Test]
    procedure TestNonReleasedRowsUntouched()
    var
        Doc: Record "CG H037 Doc";
    begin
        Doc.Get('O1');
        Assert.IsFalse(Doc.Migrated, 'O1 (OPEN) must remain Migrated=false.');
        Doc.Get('O2');
        Assert.IsFalse(Doc.Migrated, 'O2 (OPEN) must remain Migrated=false.');
        Doc.Get('P1');
        Assert.IsFalse(Doc.Migrated, 'P1 (PENDING) must remain Migrated=false.');
    end;

    [Test]
    procedure TestRowCountUnchanged()
    var
        Doc: Record "CG H037 Doc";
    begin
        // The DataTransfer must update existing rows, not insert or delete.
        Assert.AreEqual(5, Doc.Count, 'DataTransfer must not change the row count.');
    end;
}
