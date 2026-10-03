codeunit 80050 "CGR Session Context Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure SetupIsCachedUntilRefresh()
    var
        Setup: Record "CGR Setup";
        Cached: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.Reset();
        SessionContext.GetSetup(Cached);
        Assert.AreEqual(0.01, Cached."Amount Rounding Precision", 'First read loads the setup');

        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup.Modify();
        SessionContext.GetSetup(Cached);
        Assert.AreEqual(0.01, Cached."Amount Rounding Precision", 'Later reads return the cached setup');

        SessionContext.RefreshSetup();
        SessionContext.GetSetup(Cached);
        Assert.AreEqual(0.05, Cached."Amount Rounding Precision", 'Refresh reloads the setup');
    end;

    [Test]
    procedure CurrentBranchFallsBackToSetupDefault()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.Reset();
        Assert.AreEqual('NORTH', SessionContext.CurrentBranch(), 'Without an explicit branch the setup default applies');

        SessionContext.SetCurrentBranch('SOUTH');
        Assert.AreEqual('SOUTH', SessionContext.CurrentBranch(), 'An explicit branch wins');

        SessionContext.Reset();
        Assert.AreEqual('NORTH', SessionContext.CurrentBranch(), 'Reset clears the explicit branch');
    end;

    [Test]
    procedure StateIsSharedAcrossInstances()
    var
        First: Codeunit "CGR Session Context";
        Second: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        First.Reset();
        First.SetCurrentBranch('EAST');
        Assert.AreEqual('EAST', Second.CurrentBranch(), 'A second variable sees the branch set through the first');
    end;

    [Test]
    procedure NewContractTakesCurrentBranch()
    var
        Contract: Record "CGR Rental Contract";
        SessionContext: Codeunit "CGR Session Context";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.Reset();
        Lib.CreateVehicle('T-SES-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SessionContext.SetCurrentBranch('SOUTH');
        FirstContractNo := Lib.CreateContract('T-SES-001');
        SessionContext.Reset();
        SecondContractNo := Lib.CreateContract('T-SES-001');

        Contract.Get(FirstContractNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'Contract created under an explicit branch');
        Contract.Get(SecondContractNo);
        Assert.AreEqual('NORTH', Contract."Branch Code", 'Contract created after reset takes the setup default');
    end;
}
