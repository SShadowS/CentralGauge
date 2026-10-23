codeunit 80129 "CGR Allocation Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RemainderOnLastShare()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Shares.Add(999);
        Allocation.AllocateAmount(100, 3, Shares);
        Assert.AreEqual(3, Shares.Count(), 'Three shares, the earlier value is gone');
        Assert.AreEqual(33.33, Shares.Get(1), 'First share');
        Assert.AreEqual(33.33, Shares.Get(2), 'Second share');
        Assert.AreEqual(33.34, Shares.Get(3), 'Last share takes the remainder');
    end;

    [Test]
    procedure ZeroPartsRefused()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        asserterror Allocation.AllocateAmount(100, 0, Shares);
        Assert.ExpectedError('An amount can only be split into at least one part.');
    end;
}
