codeunit 80382 "CGR Xfer Success Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NaiveRefusalTxt: Label 'HX136 naive partner says no', Locked = true;

    [Test]
    procedure NaiveTransferContractFields()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Success Spy";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        ContractNo: Code[20];
    begin
        NaiveSuccessPrepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-NS1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);

        ContractNo := BranchTransfer.TransferVehicle('HX136-NS1', 'NORTH', 20250410D);

        Contract.Get(ContractNo);
        Assert.AreEqual('TRANSFER', Contract."Customer Name", 'Customer Name');
        Assert.AreEqual(20250410D, Contract."Start Date", 'Start Date');
        Assert.AreEqual(20250410D, Contract."End Date", 'End Date');
        Assert.AreEqual(Contract."Pricing Method"::Zero, Contract."Pricing Method", 'Pricing Method');
        Assert.AreEqual('NORTH', Contract."Branch Code", 'Branch Code');
        Assert.AreEqual(1, Spy.TimesTold(), 'Partner told once');
        Assert.AreEqual('NORTH', Spy.BranchWhenTold(), 'Partner sees the target branch');
    end;

    [Test]
    procedure NaiveExplicitBranchKept()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        NaiveSuccessPrepare();
        SessionContext.SetCurrentBranch('SOUTH');
        Lib.CreateVehicle('HX136-NS2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-NS3', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-NS2', 'NORTH', 20250410D);
        DeskNo := RentalMgt.CreateContract('HX136-NS3', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('SOUTH', Contract."Branch Code", 'User branch kept');
    end;

    [Test]
    procedure NaiveDefaultBranchKept()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        BranchTransfer: Codeunit "CGR Branch Transfer";
        DeskNo: Code[20];
    begin
        NaiveSuccessPrepare();
        Lib.CreateVehicle('HX136-NS4', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX136-NS5', 1000, Enum::"CGR Maintenance Strategy"::Default);

        BranchTransfer.TransferVehicle('HX136-NS4', 'NORTH', 20250410D);
        DeskNo := RentalMgt.CreateContract('HX136-NS5', 'HX136 Desk', 20250411D, 20250412D);

        Contract.Get(DeskNo);
        Assert.AreEqual('HQ', Contract."Branch Code", 'User without a branch keeps the default');
    end;

    [Test]
    procedure NaiveRefusalLeavesNothing()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Xfer Success Spy";
        BranchTransfer: Codeunit "CGR Branch Transfer";
    begin
        NaiveSuccessPrepare();
        Lib.CreateVehicle('HX136-NS6', 1000, Enum::"CGR Maintenance Strategy"::Default);
        BindSubscription(Spy);
        Spy.RefuseWith(NaiveRefusalTxt);

        Commit();
        asserterror BranchTransfer.TransferVehicle('HX136-NS6', 'NORTH', 20250410D);

        Assert.ExpectedError(NaiveRefusalTxt);
        Contract.SetRange("Vehicle No.", 'HX136-NS6');
        Assert.IsTrue(Contract.IsEmpty(), 'No transfer contract');
    end;

    local procedure NaiveSuccessPrepare()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, 'HQ', 3);
        SessionContext.Reset();
    end;
}
