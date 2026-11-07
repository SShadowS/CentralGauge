codeunit 80386 "CGR Xfer Default Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        DefaultNaiveRefusalTxt: Label 'HX136 default naive refusal', Locked = true;

    [Test]
    procedure XferDefaultTransferContract()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Default Spy";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        ContractNo: Code[20];
    begin
        XferDefaultPrepare();
        Lib.CreateVehicle('HX136-ND1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);

        ContractNo := BranchTransfer.TransferVehicle('HX136-ND1', 'NORTH', 20250410D);

        Contract.Get(ContractNo);
        Assert.AreEqual('TRANSFER', Contract."Customer Name", 'Customer Name');
        Assert.AreEqual(20250410D, Contract."Start Date", 'Start Date');
        Assert.AreEqual(20250410D, Contract."End Date", 'End Date');
        Assert.AreEqual(Contract."Pricing Method"::Zero, Contract."Pricing Method", 'Pricing Method');
        Assert.AreEqual('NORTH', Contract."Branch Code", 'Branch Code');
        Assert.AreEqual('NORTH', Spy.LastBranch(), 'Partner sees the target branch');
    end;

    [Test]
    procedure XferDefaultFollowsLaterChange()
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        XferDefaultPrepare();
        Lib.CreateVehicle('HX136-ND2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-ND3', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-ND2', 'NORTH', 20250410D);
        Setup.Get();
        Setup."Default Branch Code" := 'HQ2';
        Setup.Modify();
        SessionContext.RefreshSetup();
        DeskNo := RentalMgt.CreateContract('HX136-ND3', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('HQ2', Contract."Branch Code", 'Changed default applies');
    end;

    [Test]
    procedure XferDefaultRefusalLeavesNothing()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Default Spy";
        BranchTransfer: Codeunit "CGR Branch Transfer";
    begin
        XferDefaultPrepare();
        Lib.CreateVehicle('HX136-ND4', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.BlockWith(DefaultNaiveRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-ND4', 'NORTH', 20250410D);

        Assert.ExpectedError(DefaultNaiveRefusalTxt);
        Contract.SetRange("Vehicle No.", 'HX136-ND4');
        Assert.IsTrue(Contract.IsEmpty(), 'No transfer contract');
    end;

    local procedure XferDefaultPrepare()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, 'HQ', 3);
        SessionContext.Reset();
    end;
}
