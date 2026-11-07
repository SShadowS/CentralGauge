codeunit 80380 "CGR Branch Transfer Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        PartnerRefusalTxt: Label 'HX136 partner refuses the transfer', Locked = true;

    [Test]
    procedure BranchTransferCreatesZeroPriceContractInTargetBranch()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Transfer Partner Spy";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        ContractNo: Code[20];
    begin
        HX136Prepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-A1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);

        ContractNo := BranchTransfer.TransferVehicle('HX136-A1', 'NORTH', 20250410D);

        Contract.Get(ContractNo);
        Assert.AreEqual('HX136-A1', Contract."Vehicle No.", 'The transfer contract is for the vehicle');
        Assert.AreEqual('TRANSFER', Contract."Customer Name", 'Customer Name is TRANSFER');
        Assert.AreEqual(20250410D, Contract."Start Date", 'Start Date is the transfer date');
        Assert.AreEqual(20250410D, Contract."End Date", 'End Date is the transfer date');
        Assert.AreEqual(Contract."Pricing Method"::Zero, Contract."Pricing Method", 'Pricing Method is Zero');
        Assert.AreEqual('NORTH', Contract."Branch Code", 'The transfer contract belongs to the target branch');
        Assert.AreEqual(1, Spy.TransferNoticeCount(), 'Partners are told about the transfer contract once');
        Assert.AreEqual(ContractNo, Spy.TransferContractSeen(), 'Partners are told about the returned contract');
        Assert.AreEqual('NORTH', Spy.TransferBranchSeen(), 'When partners are told, the contract already belongs to the target branch');
    end;

    [Test]
    procedure BranchTransferKeepsUsersExplicitBranch()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        HX136Prepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-B1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-B2', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-B1', 'NORTH', 20250410D);
        DeskNo := RentalMgt.CreateContract('HX136-B2', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'A contract created after the transfer belongs to the user''s branch');
    end;

    [Test]
    procedure BranchTransferUserWithoutBranchFollowsLaterDefault()
    var
        Contract: Record "CGR Rental Contract";
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        BeforeChangeNo: Code[20];
        AfterChangeNo: Code[20];
    begin
        HX136Prepare();
        Lib.CreateVehicle('HX136-C1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-C2', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-C1', 'NORTH', 20250410D);
        BeforeChangeNo := RentalMgt.CreateContract('HX136-C2', 'HX136 Desk', 20250411D, 20250412D);
        Setup.Get();
        Setup."Default Branch Code" := 'HQ2';
        Setup.Modify();
        SessionContext.RefreshSetup();
        AfterChangeNo := RentalMgt.CreateContract('HX136-C2', 'HX136 Desk', 20250413D, 20250414D);

        Contract.Get(BeforeChangeNo);
        Assert.AreEqual('HQ', Contract."Branch Code", 'A user without a branch uses the setup default');
        Contract.Get(AfterChangeNo);
        Assert.AreEqual('HQ2', Contract."Branch Code", 'A user without a branch follows a later change of the setup default');
    end;

    [Test]
    procedure BranchTransferRefusedByPartnerLeavesNoContract()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Transfer Partner Spy";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
    begin
        HX136Prepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-D1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.RefuseTransfers(PartnerRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-D1', 'NORTH', 20250410D);

        Assert.ExpectedError(PartnerRefusalTxt);
        Assert.AreEqual(1, Spy.TransferNoticeCount(), 'The partner was told about the transfer');
        Contract.SetRange("Vehicle No.", 'HX136-D1');
        Contract.SetRange("Customer Name", 'TRANSFER');
        Assert.IsTrue(Contract.IsEmpty(), 'A refused transfer leaves no transfer contract');
    end;

    [Test]
    procedure BranchTransferRefusedByPartnerKeepsUsersBranch()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Transfer Partner Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        HX136Prepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-E1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-E2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.RefuseTransfers(PartnerRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-E1', 'NORTH', 20250410D);
        Assert.ExpectedError(PartnerRefusalTxt);

        DeskNo := RentalMgt.CreateContract('HX136-E2', 'HX136 Desk', 20250411D, 20250412D);
        Contract.Get(DeskNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'After a refused transfer, new contracts still belong to the user''s branch');
    end;

    local procedure HX136Prepare()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, 'HQ', 3);
        SessionContext.Reset();
    end;
}
