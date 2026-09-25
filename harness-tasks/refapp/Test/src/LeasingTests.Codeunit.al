codeunit 80030 "CGR Leasing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure LeaseRateUsesCoreInternal()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Expected: Decimal;
    begin
        Expected := 112;
        Assert.AreEqual(Expected, LeaseMgt.MonthlyRate(100, 12), '12 months adds 12 percent');
    end;
}
