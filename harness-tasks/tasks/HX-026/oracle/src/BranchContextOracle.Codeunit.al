codeunit 85980 "HX026 Branch Context Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure BranchSharedAcrossInstances()
    var
        FirstBranch: Codeunit "CGR Branch Context";
        SecondBranch: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D1');

        FirstBranch.SetCurrentBranch('HX26A');
        Assert.AreEqual('HX26A', SecondBranch.CurrentBranch(), 'A second variable sees the branch set through the first');
    end;

    [Test]
    procedure SetThroughSessionReadThroughBranch()
    var
        SessionContext: Codeunit "CGR Session Context";
        BranchContext: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D2');

        SessionContext.SetCurrentBranch('HX26B');
        Assert.AreEqual('HX26B', BranchContext.CurrentBranch(), 'A branch set through the session context is the current branch');
    end;

    [Test]
    procedure SetThroughBranchReadThroughSession()
    var
        SessionContext: Codeunit "CGR Session Context";
        BranchContext: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D3');

        BranchContext.SetCurrentBranch('HX26C');
        Assert.AreEqual('HX26C', SessionContext.CurrentBranch(), 'The session context reports the branch set through the branch context');
    end;

    [Test]
    procedure ResetClearsBranchContext()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        BranchContext: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D4');

        BranchContext.SetCurrentBranch('HX26E');
        SessionContext.Reset();
        Assert.AreEqual('HX26D4', BranchContext.CurrentBranch(), 'Reset clears the explicit branch of the branch context');
        Assert.AreEqual('HX26D4', SessionContext.CurrentBranch(), 'After reset the session context reports the Setup default');

        Assert.AreEqual('HX26D4', SessionContext.CurrentBranch(), 'The default is read through the session context before the Setup changes');
        Setup.Get();
        Setup."Default Branch Code" := 'HX26E4';
        Setup.Modify();
        SessionContext.Reset();
        Assert.AreEqual('HX26E4', SessionContext.CurrentBranch(), 'Reset clears the Setup cache: the session context reports the changed default');
        Assert.AreEqual('HX26E4', BranchContext.CurrentBranch(), 'Reset clears the Setup cache: the branch context reports the changed default');
    end;

    [Test]
    procedure DefaultFollowsLoadedSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        BranchContext: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D5');
        BranchContext.SetCurrentBranch('HX26X');
        SessionContext.Reset();

        Assert.AreEqual('HX26D5', BranchContext.CurrentBranch(), 'Without an explicit branch the Setup default applies');
        Setup.Get();
        Setup."Default Branch Code" := 'HX26M';
        Setup.Modify();
        Assert.AreEqual('HX26D5', BranchContext.CurrentBranch(), 'The default comes from the Setup the session has loaded');
        SessionContext.RefreshSetup();
        Assert.AreEqual('HX26M', BranchContext.CurrentBranch(), 'RefreshSetup makes the changed default visible');
    end;

    [Test]
    procedure RefreshKeepsExplicitBranch()
    var
        SessionContext: Codeunit "CGR Session Context";
        BranchContext: Codeunit "CGR Branch Context";
    begin
        WorkDate(20270301D);
        InitSetup('HX26D6');

        BranchContext.SetCurrentBranch('HX26F');
        SessionContext.RefreshSetup();
        Assert.AreEqual('HX26F', BranchContext.CurrentBranch(), 'RefreshSetup keeps the explicit branch');
        Assert.AreEqual('HX26F', SessionContext.CurrentBranch(), 'The session context still reports the explicit branch');
    end;

    [Test]
    procedure NewContractTakesBranchContextBranch()
    var
        Contract: Record "CGR Rental Contract";
        BranchContext: Codeunit "CGR Branch Context";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup('HX26D7');
        InitVehicle('HX026-G');

        BranchContext.SetCurrentBranch('HX26G');
        ContractNo := RentalMgt.CreateContract('HX026-G', 'HX026 Customer', 20270305D, 20270307D);
        Contract.Get(ContractNo);
        Assert.AreEqual('HX26G', Contract."Branch Code", 'A new contract takes the branch of the branch context');
    end;

    local procedure InitSetup(DefaultBranchCode: Code[10])
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Default Branch Code" := DefaultBranchCode;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
    begin
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;
}
