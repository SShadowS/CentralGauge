codeunit 80384 "CGR Xfer Branch Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        BranchNaiveRefusalTxt: Label 'HX136 branch naive refusal', Locked = true;

    [Test]
    procedure XferBranchStoredOnContract()
    var
        Contract: Record "CGR Rental Contract";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        ContractNo: Code[20];
    begin
        XferBranchPrepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-NB1', 1000, Enum::"CGR Maintenance Strategy"::Default);

        ContractNo := BranchTransfer.TransferVehicle('HX136-NB1', 'NORTH', 20250410D);

        Contract.Get(ContractNo);
        Assert.AreEqual('TRANSFER', Contract."Customer Name", 'Customer Name');
        Assert.AreEqual(20250410D, Contract."Start Date", 'Start Date');
        Assert.AreEqual(20250410D, Contract."End Date", 'End Date');
        Assert.AreEqual(Contract."Pricing Method"::Zero, Contract."Pricing Method", 'Pricing Method');
        Assert.AreEqual('NORTH', Contract."Branch Code", 'Branch Code is the target branch');
    end;

    [Test]
    procedure XferBranchExplicitUserBranchKept()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        XferBranchPrepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-NB2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-NB3', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-NB2', 'NORTH', 20250410D);
        DeskNo := RentalMgt.CreateContract('HX136-NB3', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'User branch kept');
    end;

    [Test]
    procedure XferBranchDefaultFollowsSetup()
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        XferBranchPrepare();
        Lib.CreateVehicle('HX136-NB4', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-NB5', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-NB4', 'NORTH', 20250410D);
        Setup.Get();
        Setup."Default Branch Code" := 'HQ2';
        Setup.Modify();
        SessionContext.RefreshSetup();
        DeskNo := RentalMgt.CreateContract('HX136-NB5', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('HQ2', Contract."Branch Code", 'Changed default applies');
    end;

    [Test]
    procedure XferBranchRefusalLeavesNothing()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Branch Spy";
        BranchTransfer: Codeunit "CGR Branch Transfer";
    begin
        XferBranchPrepare();
        Lib.CreateVehicle('HX136-NB6', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.SayNo(BranchNaiveRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-NB6', 'NORTH', 20250410D);

        Assert.ExpectedError(BranchNaiveRefusalTxt);
        Contract.SetRange("Vehicle No.", 'HX136-NB6');
        Assert.IsTrue(Contract.IsEmpty(), 'No transfer contract');
    end;

    [Test]
    procedure XferBranchRefusalKeepsUserBranch()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Branch Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        XferBranchPrepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-NB7', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-NB8', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.SayNo(BranchNaiveRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-NB7', 'NORTH', 20250410D);
        Assert.ExpectedError(BranchNaiveRefusalTxt);

        DeskNo := RentalMgt.CreateContract('HX136-NB8', 'HX136 Desk', 20250411D, 20250412D);
        Contract.Get(DeskNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'User branch kept after refusal');
    end;

    local procedure XferBranchPrepare()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, 'HQ', 3);
        SessionContext.Reset();
    end;
}
