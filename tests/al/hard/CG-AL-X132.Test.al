codeunit 89352 "CG-AL-X132 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the real table before seeding its own rows - even
    // tests that only exercise a working copy, which never touches the
    // database at all.

    local procedure SeedReal(EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Init();
        BalanceLine."Entry No." := EntryNo;
        BalanceLine."Account No." := AccountNo;
        BalanceLine.Amount := InitialAmount;
        BalanceLine.Reviewed := false;
        BalanceLine.Insert();
    end;

    local procedure SeedWorkingCopy(var TempBalanceLine: Record "CG X132 Balance Line" temporary; EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    begin
        TempBalanceLine.Init();
        TempBalanceLine."Entry No." := EntryNo;
        TempBalanceLine."Account No." := AccountNo;
        TempBalanceLine.Amount := InitialAmount;
        TempBalanceLine.Reviewed := false;
        TempBalanceLine.Insert();
    end;

    local procedure RealAmount(EntryNo: Integer): Decimal
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Amount);
    end;

    local procedure RealReviewed(EntryNo: Integer): Boolean
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Reviewed);
    end;

    [Test]
    procedure ProcessBufferMarksWorkingCopyLinesAndReturnsTheTotal()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
        Total: Decimal;
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);
        SeedWorkingCopy(TempBalanceLine, 3, 'ACC-B', 7);

        Total := Buffer.ProcessBuffer(TempBalanceLine);

        Assert.AreEqual(42.0, Total, 'Expected the total across every working-copy line');
        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure ProcessBufferReturnsZeroForAnEmptyWorkingCopy()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Assert.AreEqual(0.0, Buffer.ProcessBuffer(TempBalanceLine), 'Expected an empty working copy to total zero, not raise an error');
    end;

    [Test]
    procedure ProcessBufferRefusesTheRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ProcessBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;

    [Test]
    procedure ArchiveBufferClearsWorkingCopyLinesAndMarksThemReviewed()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected every working-copy line to be cleared to zero');
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure ArchiveBufferOnAnEmptyWorkingCopyCompletesWithoutError()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Buffer.ArchiveBuffer(TempBalanceLine);

        Assert.AreEqual(0, TempBalanceLine.Count(), 'Expected an empty working copy to stay empty after archiving');
    end;

    [Test]
    procedure ArchiveBufferOnAWorkingCopyLimitedToOneAccountOnlyTouchesThatAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        SeedWorkingCopy(TempBalanceLine, 2, 'ACC-B', 40);
        TempBalanceLine.Reset();
        TempBalanceLine.SetRange("Account No.", 'ACC-A');

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.Get(1);
        Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected the selected ACC-A working-copy line to be cleared');
        Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected the selected ACC-A working-copy line to be marked reviewed');
        TempBalanceLine.Get(2);
        Assert.AreEqual(40.0, TempBalanceLine.Amount, 'Expected the ACC-B working-copy line outside the selection to be untouched');
        Assert.IsFalse(TempBalanceLine.Reviewed, 'Expected the ACC-B working-copy line outside the selection to stay unreviewed');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheRealTableWhenLimitedToOneAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(101, 'ACC-A', 12);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(12.0, RealAmount(101), 'Expected the second real ACC-A row to be untouched after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheWholeRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        SeedReal(100, 'ACC-A', 55);
        SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.Reset();
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, RealAmount(200), 'Expected the real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(RealReviewed(200), 'Expected the real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure ArchiveBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;
}
