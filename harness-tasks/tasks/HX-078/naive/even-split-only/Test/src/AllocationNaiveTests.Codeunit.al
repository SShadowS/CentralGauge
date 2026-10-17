codeunit 80129 "CGR Allocation Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure EvenSplitIntoFour()
    var
        Allocation: Codeunit "CGR Amount Allocation";
        Shares: List of [Decimal];
        Share: Decimal;
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0, '', 3);
        Allocation.AllocateAmount(100, 4, Shares);
        Assert.AreEqual(4, Shares.Count(), '100 into 4 gives four shares');
        foreach Share in Shares do
            Assert.AreEqual(25, Share, 'Each share is 25');
    end;
}
