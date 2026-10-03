codeunit 85600 "HX007 Branch Rounding Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PreviewUsesContractBranch()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '');
        SetBranchRounding('HX7PA', 1);
        InitVehicle('HX007-A');
        ContractNo := ReturnedContract('HX007-A', 'HX7PA');

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLines(PreviewLine, 100.00, 33.00, 2.00);
        Assert.AreEqual(135.00,Preview.TotalAmount(PreviewLine), 'Preview total at the branch precision');
    end;

    [Test]
    procedure PostingUsesContractBranch()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '');
        SetBranchRounding('HX7QA', 1);
        InitVehicle('HX007-B');
        ContractNo := ReturnedContract('HX007-B', 'HX7QA');

        RentalMgt.Post(ContractNo);
        Assert.AreEqual(135.00,PostedAmount(ContractNo), 'Posted amount is the sum of the lines at the branch precision');
    end;

    [Test]
    procedure ContractKeepsCreationBranch()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '');
        SetBranchRounding('HX7CA', 1);
        SetBranchRounding('HX7CB', 0.05);
        InitVehicle('HX007-C');
        ContractNo := ReturnedContract('HX007-C', 'HX7CA');
        SessionContext.SetCurrentBranch('HX7CB');

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLines(PreviewLine, 100.00, 33.00, 2.00);
        Assert.AreEqual(135.00,Preview.TotalAmount(PreviewLine), 'Preview total uses the branch of the contract');
        RentalMgt.Post(ContractNo);
        Assert.AreEqual(135.00,PostedAmount(ContractNo), 'Posted amount uses the branch of the contract');
    end;

    [Test]
    procedure BatchPostsEachContractsBranch()
    var
        Contract: Record "CGR Rental Contract";
        BatchPost: Codeunit "CGR Rental Batch Post";
        SessionContext: Codeunit "CGR Session Context";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, '');
        SetBranchRounding('HX7BA', 1);
        SetBranchRounding('HX7BB', 0.05);
        InitVehicle('HX007-D1');
        InitVehicle('HX007-D2');
        FirstContractNo := ReturnedContract('HX007-D1', 'HX7BA');
        SecondContractNo := ReturnedContract('HX007-D2', 'HX7BB');
        SessionContext.SetCurrentBranch('HX7BX');

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX007-D1', 'HX007-D2');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'Both contracts are posted');
        Assert.AreEqual(135.00,PostedAmount(FirstContractNo), 'First contract at precision 1');
        Assert.AreEqual(135.65, PostedAmount(SecondContractNo), 'Second contract at precision 0.05');
    end;

    [Test]
    procedure BranchWithoutRowUsesSetup()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        BranchRounding: Record "CGR Branch Rounding";
        Preview: Codeunit "CGR Rental Invoice Preview";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.05, '');
        if BranchRounding.Get('HX7NR') then
            BranchRounding.Delete();
        SetBranchRounding('HX7NS', 1);
        InitVehicle('HX007-E');
        ContractNo := ReturnedContract('HX007-E', 'HX7NR');
        SessionContext.SetCurrentBranch('HX7NS');

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLines(PreviewLine, 100.00, 33.35, 2.30);
        Assert.AreEqual(135.65, Preview.TotalAmount(PreviewLine), 'Preview total at the Setup precision');
        RentalMgt.Post(ContractNo);
        Assert.AreEqual(135.65, PostedAmount(ContractNo), 'Posted amount at the Setup precision');
    end;

    [Test]
    procedure ZeroBranchPrecisionUsesSetup()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.05, '');
        SetBranchRounding('HX7ZA', 0);
        InitVehicle('HX007-F');
        ContractNo := ReturnedContract('HX007-F', 'HX7ZA');

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLines(PreviewLine, 100.00, 33.35, 2.30);
        Assert.AreEqual(135.65, Preview.TotalAmount(PreviewLine), 'A zero branch precision keeps the Setup precision');
        RentalMgt.Post(ContractNo);
        Assert.AreEqual(135.65, PostedAmount(ContractNo), 'Posted amount at the Setup precision');
    end;

    [Test]
    procedure FinerBranchPrecisionWins()
    var
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.05, '');
        SetBranchRounding('HX7FA', 0.01);
        InitVehicle('HX007-G');
        ContractNo := ReturnedContract('HX007-G', 'HX7FA');

        Preview.BuildPreview(ContractNo, PreviewLine);
        AssertLines(PreviewLine, 99.99, 33.33, 2.31);
        Assert.AreEqual(135.63, Preview.TotalAmount(PreviewLine), 'A finer branch precision applies');
        RentalMgt.Post(ContractNo);
        Assert.AreEqual(135.63, PostedAmount(ContractNo), 'Posted amount at the finer branch precision');
    end;

    [Test]
    procedure PricingKeepsSessionBranch()
    var
        Contract: Record "CGR Rental Contract";
        PreviewLine: Record "CGR Invoice Preview Line";
        Preview: Codeunit "CGR Rental Invoice Preview";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, 'HX7SD');
        SetBranchRounding('HX7SA', 1);
        InitVehicle('HX007-H');
        FirstContractNo := ReturnedContract('HX007-H', 'HX7SA');
        SessionContext.SetCurrentBranch('HX7SB');

        Preview.BuildPreview(FirstContractNo, PreviewLine);
        RentalMgt.Post(FirstContractNo);
        SecondContractNo := RentalMgt.CreateContract('HX007-H', 'HX007 Customer', 20270312D, 20270314D);

        Assert.AreEqual('HX7SB', SessionContext.CurrentBranch(), 'The current branch of the session is unchanged');
        Contract.Get(SecondContractNo);
        Assert.AreEqual('HX7SB', Contract."Branch Code", 'A new contract takes the current branch of the session');
    end;

    [Test]
    procedure LeaseInvoiceKeepsSetupPrecision()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01, 'HX7LB');
        SetBranchRounding('HX7LB', 1);
        LeaseNo := LeaseMgt.CreateContract('HX007-L', 'HX007 Customer', 20270301D, 3, 101);
        LeaseMgt.CreateSchedule(LeaseNo);

        Assert.AreEqual(1, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270301D), 'The March line is due');
        InvoiceLine.Get(LeaseNo, 10000);
        Assert.AreEqual(104.03, InvoiceLine.Amount, 'Lease invoice lines keep the Setup precision');
    end;

    local procedure InitSetup(RoundingPrecision: Decimal; DefaultBranchCode: Code[10])
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 50;
        Setup."Km Allowance per Day" := 100;
        Setup."Excess Km Rate" := 0.33;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup."Default Branch Code" := DefaultBranchCode;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure SetBranchRounding(BranchCode: Code[10]; RoundingPrecision: Decimal)
    var
        BranchRounding: Record "CGR Branch Rounding";
    begin
        if BranchRounding.Get(BranchCode) then
            BranchRounding.Delete();
        BranchRounding.Init();
        BranchRounding."Branch Code" := BranchCode;
        BranchRounding."Rounding Precision" := RoundingPrecision;
        BranchRounding.Insert();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 33.33;
        Vehicle.Insert();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]; BranchCode: Code[10]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        ContractNo: Code[20];
    begin
        SessionContext.SetCurrentBranch(BranchCode);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX007 Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1307, '');
        exit(ContractNo);
    end;

    local procedure AssertLines(var PreviewLine: Record "CGR Invoice Preview Line"; RentalDaysAmount: Decimal; SurchargeAmount: Decimal; ExcessKmAmount: Decimal)
    begin
        Assert.AreEqual(3, PreviewLine.Count(), 'Rental days, weekend surcharge and excess km');
        PreviewLine.FindSet();
        Assert.AreEqual('Rental days', PreviewLine.Description, 'First line');
        Assert.AreEqual(RentalDaysAmount, PreviewLine.Amount, 'Rental days: 3 x 33.33');
        PreviewLine.Next();
        Assert.AreEqual('Weekend surcharge', PreviewLine.Description, 'Second line');
        Assert.AreEqual(SurchargeAmount, PreviewLine.Amount, 'Weekend surcharge: 2 x 16.665');
        PreviewLine.Next();
        Assert.AreEqual('Excess km', PreviewLine.Description, 'Third line');
        Assert.AreEqual(ExcessKmAmount, PreviewLine.Amount, 'Excess km: 7 x 0.33');
    end;

    local procedure PostedAmount(ContractNo: Code[20]): Decimal
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'One ledger entry per posted contract');
        LedgerEntry.FindFirst();
        exit(LedgerEntry.Amount);
    end;
}
