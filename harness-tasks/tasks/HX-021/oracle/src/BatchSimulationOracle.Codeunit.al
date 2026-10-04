codeunit 85880 "HX021 Batch Simulation Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SimulatesEveryReturnedContract()
    var
        Contract: Record "CGR Rental Contract";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        BatchPost: Codeunit "CGR Rental Batch Post";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-1A', 50);
        InitVehicle('HX021-1B', 60);
        FirstContractNo := ReturnedContract('HX021-1A');
        SecondContractNo := ReturnedContract('HX021-1B');

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX021-1A', 'HX021-1B');
        Assert.AreEqual(2, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Both returned contracts would post');
        Assert.AreEqual(2, LedgerBuffer.Count(), 'One simulated ledger entry per contract');
        AssertSimulatedEntry(LedgerBuffer, FirstContractNo, 'HX021-1A', 150.00);
        AssertSimulatedEntry(LedgerBuffer, SecondContractNo, 'HX021-1B', 180.00);
        Assert.AreEqual(0, ErrorBuffer.Count(), 'No contract would fail');
    end;

    [Test]
    procedure SimulationChangesNothing()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        BatchPost: Codeunit "CGR Rental Batch Post";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
        LedgerCountBefore: Integer;
        ErrorCountBefore: Integer;
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-2A', 50);
        InitVehicle('HX021-2B', 50);
        FirstContractNo := ReturnedContract('HX021-2A');
        SecondContractNo := ReturnedContract('HX021-2B');
        LedgerCountBefore := LedgerEntry.Count();
        ErrorCountBefore := PostError.Count();

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX021-2A', 'HX021-2B');
        Assert.AreEqual(2, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Both returned contracts would post');
        AssertReturnedUnposted(FirstContractNo, 'First contract');
        AssertReturnedUnposted(SecondContractNo, 'Second contract');
        LedgerEntry.SetFilter("Vehicle No.", '%1|%2', 'HX021-2A', 'HX021-2B');
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry for the simulated vehicles');
        LedgerEntry.Reset();
        Assert.AreEqual(LedgerCountBefore, LedgerEntry.Count(), 'The rental ledger is unchanged');
        Assert.AreEqual(ErrorCountBefore, PostError.Count(), 'Nothing is logged in CGR Batch Post Error');
    end;

    [Test]
    procedure OnlyReturnedContractsInFilter()
    var
        Contract: Record "CGR Rental Contract";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        BatchPost: Codeunit "CGR Rental Batch Post";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ReturnedContractNo: Code[20];
        OutsideContractNo: Code[20];
        CheckedOutContractNo: Code[20];
        PostedContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-3A', 50);
        InitVehicle('HX021-3C', 50);
        InitVehicle('HX021-3K', 50);
        InitVehicle('HX021-3P', 50);
        InitVehicle('HX021-3D', 50);
        ReturnedContractNo := ReturnedContract('HX021-3A');
        RentalMgt.CreateContract('HX021-3C', 'HX021 Customer', 20270301D, 20270303D);
        CheckedOutContractNo := RentalMgt.CreateContract('HX021-3K', 'HX021 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(CheckedOutContractNo);
        PostedContractNo := ReturnedContract('HX021-3P');
        RentalMgt.Post(PostedContractNo);
        OutsideContractNo := ReturnedContract('HX021-3D');

        Contract.SetFilter("Vehicle No.", '%1|%2|%3|%4', 'HX021-3A', 'HX021-3C', 'HX021-3K', 'HX021-3P');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Only the returned contract in the filter would post');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(ReturnedContractNo, LedgerBuffer."Contract No.", 'The simulated entry is the returned contract''s');
        Assert.AreEqual(0, ErrorBuffer.Count(), 'Open, checked out and posted contracts are not simulated');
        AssertReturnedUnposted(OutsideContractNo, 'Contract outside the filter');
    end;

    [Test]
    procedure RejectedContractReported()
    var
        Contract: Record "CGR Rental Contract";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodContractNo: Code[20];
        RejectedContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-4A', 50);
        InitVehicle('HX021-4B', 50);
        GoodContractNo := ReturnedContract('HX021-4A');
        RejectedContractNo := ReturnedContract('HX021-4B');
        PostingExtension.RejectContract(RejectedContractNo);
        BindSubscription(PostingExtension);

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX021-4A', 'HX021-4B');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Only the contract the extension accepts would post');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(GoodContractNo, LedgerBuffer."Contract No.", 'The simulated entry is the accepted contract''s');
        AssertSimulatedError(ErrorBuffer, RejectedContractNo, 1);
        AssertReturnedUnposted(RejectedContractNo, 'Rejected contract');
    end;

    [Test]
    procedure CommittingExtensionLeavesNothing()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodContractNo: Code[20];
        RejectedContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-5A', 50);
        InitVehicle('HX021-5B', 50);
        RemoveMarker('HX021-M5');
        GoodContractNo := ReturnedContract('HX021-5A');
        RejectedContractNo := ReturnedContract('HX021-5B');
        PostingExtension.MarkContract(RejectedContractNo, 'HX021-M5');
        PostingExtension.CommitOnContract(RejectedContractNo);
        PostingExtension.RejectContract(RejectedContractNo);
        BindSubscription(PostingExtension);

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX021-5A', 'HX021-5B');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Only the contract the extension accepts would post');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(GoodContractNo, LedgerBuffer."Contract No.", 'The simulated entry is the accepted contract''s');
        AssertSimulatedError(ErrorBuffer, RejectedContractNo, 1);
        AssertReturnedUnposted(RejectedContractNo, 'Contract whose extension committed');
        Assert.IsFalse(Vehicle.Get('HX021-M5'), 'What the committing extension wrote is not kept');
        AssertReturnedUnposted(GoodContractNo, 'Accepted contract');
    end;

    [Test]
    procedure ExtensionWritesNotKept()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-6A', 50);
        RemoveMarker('HX021-M6');
        ContractNo := ReturnedContract('HX021-6A');
        PostingExtension.MarkContract(ContractNo, 'HX021-M6');
        BindSubscription(PostingExtension);

        Contract.SetRange("Vehicle No.", 'HX021-6A');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'The contract would post');
        AssertSimulatedEntry(LedgerBuffer, ContractNo, 'HX021-6A', 150.00);
        Assert.AreEqual(0, ErrorBuffer.Count(), 'No contract would fail');
        Assert.IsFalse(Vehicle.Get('HX021-M6'), 'What the extension wrote is not kept');
        AssertReturnedUnposted(ContractNo, 'Simulated contract');
    end;

    [Test]
    procedure TwoRejectionsBothReported()
    var
        Contract: Record "CGR Rental Contract";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodContractNo: Code[20];
        FirstRejectedNo: Code[20];
        SecondRejectedNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-7A', 50);
        InitVehicle('HX021-7B', 50);
        InitVehicle('HX021-7C', 50);
        GoodContractNo := ReturnedContract('HX021-7A');
        FirstRejectedNo := ReturnedContract('HX021-7B');
        SecondRejectedNo := ReturnedContract('HX021-7C');
        PostingExtension.RejectContract(FirstRejectedNo);
        PostingExtension.RejectContract(SecondRejectedNo);
        BindSubscription(PostingExtension);

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'HX021-7A', 'HX021-7B', 'HX021-7C');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'Only the accepted contract would post');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(GoodContractNo, LedgerBuffer."Contract No.", 'The simulated entry is the accepted contract''s');
        AssertSimulatedError(ErrorBuffer, FirstRejectedNo, 2);
        AssertSimulatedError(ErrorBuffer, SecondRejectedNo, 2);
    end;

    [Test]
    procedure BuffersAreReplaced()
    var
        Contract: Record "CGR Rental Contract";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        RejectedContractNo: Code[20];
        LaterContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-8A', 50);
        InitVehicle('HX021-8B', 50);
        InitVehicle('HX021-8E', 50);
        ReturnedContract('HX021-8A');
        RejectedContractNo := ReturnedContract('HX021-8B');
        LaterContractNo := ReturnedContract('HX021-8E');
        PostingExtension.RejectContract(RejectedContractNo);
        BindSubscription(PostingExtension);
        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX021-8A', 'HX021-8B');
        BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer);

        LedgerBuffer.SetRange("Contract No.", LaterContractNo);
        ErrorBuffer.SetRange("Contract No.", LaterContractNo);
        Contract.Reset();
        Contract.SetRange("Vehicle No.", 'HX021-8E');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'The later contract would post');
        LedgerBuffer.Reset();
        ErrorBuffer.Reset();
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The ledger buffer holds only the later simulation');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(LaterContractNo, LedgerBuffer."Contract No.", 'The ledger buffer holds the later contract');
        Assert.AreEqual(0, ErrorBuffer.Count(), 'The error buffer holds only the later simulation');
    end;

    [Test]
    procedure SimulatedEntryEqualsPostedEntry()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        BatchPost: Codeunit "CGR Rental Batch Post";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(50, 100, 0.33);
        InitVehicle('HX021-9A', 33.33);
        ContractNo := RentalMgt.CreateContract('HX021-9A', 'HX021 Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1307, '');

        Contract.SetRange("Vehicle No.", 'HX021-9A');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'The contract would post');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry');
        RentalMgt.Post(ContractNo);
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'Posting creates one ledger entry');
        LedgerEntry.FindFirst();
        LedgerBuffer.FindFirst();
        Assert.AreEqual(LedgerEntry."Contract No.", LedgerBuffer."Contract No.", 'Simulated contract no. equals the posted one');
        Assert.AreEqual(LedgerEntry."Vehicle No.", LedgerBuffer."Vehicle No.", 'Simulated vehicle no. equals the posted one');
        Assert.AreEqual(LedgerEntry."Posting Date", LedgerBuffer."Posting Date", 'Simulated posting date equals the posted one');
        Assert.AreEqual(LedgerEntry.Amount, LedgerBuffer.Amount, 'Simulated amount equals the posted one');
        Assert.AreEqual(LedgerEntry."Km Driven", LedgerBuffer."Km Driven", 'Simulated km driven equals the posted one');
        Assert.AreEqual(135.63, LedgerBuffer.Amount, 'Simulated amount 99.99 + 33.33 + 2.31');
    end;

    [Test]
    procedure CommittingExtensionNotKept()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        ErrorBuffer: Record "CGR Batch Post Error" temporary;
        PostingExtension: Codeunit "HX021 Posting Extension";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0, 1000, 0);
        InitVehicle('HX021-10A', 50);
        RemoveMarker('HX021-M10');
        ContractNo := ReturnedContract('HX021-10A');
        PostingExtension.MarkContract(ContractNo, 'HX021-M10');
        PostingExtension.CommitOnContract(ContractNo);
        BindSubscription(PostingExtension);

        Contract.SetRange("Vehicle No.", 'HX021-10A');
        Assert.AreEqual(1, BatchPost.SimulateBatch(Contract, LedgerBuffer, ErrorBuffer), 'The contract would post');
        AssertSimulatedEntry(LedgerBuffer, ContractNo, 'HX021-10A', 150.00);
        Assert.AreEqual(0, ErrorBuffer.Count(), 'No contract would fail');
        AssertReturnedUnposted(ContractNo, 'Contract whose extension committed');
        Assert.IsFalse(Vehicle.Get('HX021-M10'), 'What the committing extension wrote is not kept');
    end;

    local procedure InitSetup(WeekendSurchargePct: Decimal; KmAllowancePerDay: Integer; ExcessKmRate: Decimal)
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := WeekendSurchargePct;
        Setup."Km Allowance per Day" := KmAllowancePerDay;
        Setup."Excess Km Rate" := ExcessKmRate;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20]; DailyRate: Decimal)
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
        Vehicle."Daily Rate" := DailyRate;
        Vehicle.Insert();
    end;

    local procedure RemoveMarker(MarkerVehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(MarkerVehicleNo) then
            Vehicle.Delete();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX021 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure AssertSimulatedEntry(var LedgerBuffer: Record "CGR Rental Ledger Entry" temporary; ContractNo: Code[20]; VehicleNo: Code[20]; ExpectedAmount: Decimal)
    begin
        LedgerBuffer.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerBuffer.Count(), 'One simulated ledger entry for the contract');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(VehicleNo, LedgerBuffer."Vehicle No.", 'Simulated vehicle no.');
        Assert.AreEqual(20270303D, LedgerBuffer."Posting Date", 'Simulated posting date is the contract end date');
        Assert.AreEqual(ExpectedAmount, LedgerBuffer.Amount, 'Simulated amount');
        Assert.AreEqual(100, LedgerBuffer."Km Driven", 'Simulated km driven');
        LedgerBuffer.Reset();
    end;

    local procedure AssertSimulatedError(var ErrorBuffer: Record "CGR Batch Post Error" temporary; ContractNo: Code[20]; ExpectedRows: Integer)
    begin
        Assert.AreEqual(ExpectedRows, ErrorBuffer.Count(), 'Error buffer rows');
        ErrorBuffer.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, ErrorBuffer.Count(), 'One error row for the refused contract');
        ErrorBuffer.FindFirst();
        Assert.AreEqual(StrSubstNo('HX021 rejects %1.', ContractNo), ErrorBuffer."Error Message", 'The error text posting raises');
        ErrorBuffer.Reset();
    end;

    local procedure AssertReturnedUnposted(ContractNo: Code[20]; What: Text)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, What + ' stays returned');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), What + ' has no ledger entry');
    end;
}
