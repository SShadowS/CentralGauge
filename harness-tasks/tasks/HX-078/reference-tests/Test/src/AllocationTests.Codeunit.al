codeunit 80128 "CGR Allocation Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NoPartsErr: Label 'An amount can only be split into at least one part.';

    [Test]
    procedure ThreeWayRemainderOnLastShare()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.33, 33.33, 33.34, '100 into 3 at 0.01');
        Assert.AreEqual(100, Shares.Get(1) + Shares.Get(2) + Shares.Get(3), 'The shares add up to the total');
    end;

    [Test]
    procedure PrefilledSharesReplaced()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Shares.Add(999);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.33, 33.33, 33.34, 'A pre-filled list is replaced');
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
        Assert.ExpectedError(NoPartsErr);
    end;

    [Test]
    procedure NegativePartsRefused()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        asserterror Allocation.AllocateAmount(100, -1, Shares);
        Assert.ExpectedError(NoPartsErr);
    end;

    [Test]
    procedure WholeUnitPrecisionShares()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(1, '', 3);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33, 33, 34, '100 into 3 at precision 1');
    end;

    [Test]
    procedure FiveCentPrecisionShares()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.05, '', 3);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.35, 33.35, 33.30, '100 into 3 at precision 0.05');
    end;

    [Test]
    procedure ZeroPrecisionUsesCents()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0, '', 3);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.33, 33.33, 33.34, '100 into 3 at precision 0');
    end;

    [Test]
    procedure PrecisionCachedUntilRefresh()
    var
        Setup: Record "CGR Setup";
        Allocation: Codeunit "CGR Amount Allocation";
        SessionContext: Codeunit "CGR Session Context";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.33, 33.33, 33.34, 'Precision loaded at 0.01');

        Setup.Get();
        Setup."Amount Rounding Precision" := 1;
        Setup.Modify();
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33.33, 33.33, 33.34, 'A Setup change waits for RefreshSetup');

        SessionContext.RefreshSetup();
        Allocation.AllocateAmount(100, 3, Shares);
        AssertThreeShares(Shares, 33, 33, 34, 'After RefreshSetup the new precision applies');
    end;

    [Test]
    procedure NegativeTotalShares()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Allocation.AllocateAmount(-100, 3, Shares);
        AssertThreeShares(Shares, -33.33, -33.33, -33.34, '-100 into 3 at 0.01');
        Assert.AreEqual(-100, Shares.Get(1) + Shares.Get(2) + Shares.Get(3), 'The shares add up to the negative total');
    end;

    [Test]
    procedure SinglePartTakesTotal()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Allocation.AllocateAmount(100, 1, Shares);
        Assert.AreEqual(1, Shares.Count(), 'One part gives one share');
        Assert.AreEqual(100, Shares.Get(1), 'One part takes the whole total');
    end;

    local procedure AssertThreeShares(Shares: List of [Decimal]; First: Decimal; Second: Decimal; Third: Decimal; Context: Text)
    begin
        Assert.AreEqual(3, Shares.Count(), Context + ': share count');
        Assert.AreEqual(First, Shares.Get(1), Context + ': first share');
        Assert.AreEqual(Second, Shares.Get(2), Context + ': second share');
        Assert.AreEqual(Third, Shares.Get(3), Context + ': last share');
    end;
}
