codeunit 80071 "CGR Batch Post Run Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PostsOnlyReturnedInFilter()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ReturnedNo: Code[20];
        OpenNo: Code[20];
        CheckedOutNo: Code[20];
        OutsideNo: Code[20];
    begin
        InitBatchScenario();
        CreateRentalVehicle('T-BR-001');
        CreateRentalVehicle('T-BR-002');
        CreateRentalVehicle('T-BR-003');
        CreateRentalVehicle('T-BR-004');
        ReturnedNo := Lib.CreateReturnedContract('T-BR-001', 20270301D, 20270303D, 1100);
        OpenNo := Lib.CreateContract('T-BR-002');
        CheckedOutNo := Lib.CreateContract('T-BR-003');
        RentalMgt.CheckOut(CheckedOutNo);
        OutsideNo := Lib.CreateReturnedContract('T-BR-004', 20270301D, 20270303D, 1100);

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BR-001', 'T-BR-002', 'T-BR-003');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Only the returned contract in the filter is posted');

        AssertPosted(ReturnedNo);
        AssertUntouched(OpenNo, Contract.Status::Open);
        AssertUntouched(CheckedOutNo, Contract.Status::"Checked Out");
        AssertUntouched(OutsideNo, Contract.Status::Returned);
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No error recorded');
    end;

    [Test]
    procedure FailedContractStaysReturned()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodNo: Code[20];
        FailingNo: Code[20];
    begin
        InitBatchScenario();
        CreateRentalVehicle('T-BR-011');
        CreateRentalVehicle('T-BR-012');
        GoodNo := Lib.CreateReturnedContract('T-BR-011', 20270301D, 20270303D, 1100);
        FailingNo := Lib.CreateReturnedContract('T-BR-012', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(FailingNo);
        BindSubscription(Subscribers);

        Contract.SetFilter("Vehicle No.", '%1|%2', 'T-BR-011', 'T-BR-012');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Only the good contract is posted');

        AssertPosted(GoodNo);
        AssertUntouched(FailingNo, Contract.Status::Returned);
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(1, PostError.Count(), 'One error recorded');
        PostError.FindFirst();
        Assert.AreEqual(FailingNo, PostError."Contract No.", 'Error names the failing contract');
        Assert.AreEqual(StrSubstNo('Simulated failure after commit for %1.', FailingNo), PostError."Error Message", 'Error text');
    end;

    [Test]
    procedure PostingContinuesAfterFailures()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FailingNo: Code[20];
        GoodNo: Code[20];
        NoVehicleNo: Code[20];
    begin
        InitBatchScenario();
        CreateRentalVehicle('T-BR-021');
        CreateRentalVehicle('T-BR-022');
        CreateRentalVehicle('T-BR-023');
        FailingNo := Lib.CreateReturnedContract('T-BR-021', 20270301D, 20270303D, 1100);
        GoodNo := Lib.CreateReturnedContract('T-BR-022', 20270301D, 20270303D, 1100);
        NoVehicleNo := Lib.CreateReturnedContract('T-BR-023', 20270301D, 20270303D, 1100);
        Vehicle.Get('T-BR-023');
        Vehicle.Delete();
        Subscribers.FailPostingAfterCommit(FailingNo);
        BindSubscription(Subscribers);

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BR-021', 'T-BR-022', 'T-BR-023');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'The good contract is posted despite two failures');

        AssertPosted(GoodNo);
        AssertUntouched(FailingNo, Contract.Status::Returned);
        AssertUntouched(NoVehicleNo, Contract.Status::Returned);
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(2, PostError.Count(), 'Both failures recorded under the batch id');
        PostError.SetRange("Contract No.", FailingNo);
        Assert.AreEqual(1, PostError.Count(), 'Failure of the commit-then-fail contract recorded');
        PostError.SetRange("Contract No.", NoVehicleNo);
        Assert.AreEqual(1, PostError.Count(), 'Failure of the contract without vehicle recorded');
    end;

    [Test]
    procedure EachRunGetsOwnBatchId()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
        FirstBatchId: Guid;
        SecondBatchId: Guid;
    begin
        InitBatchScenario();
        CreateRentalVehicle('T-BR-031');
        ContractNo := Lib.CreateReturnedContract('T-BR-031', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(ContractNo);
        BindSubscription(Subscribers);
        Contract.SetRange("Vehicle No.", 'T-BR-031');

        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'First run posts nothing');
        FirstBatchId := BatchPost.LastBatchId();
        Assert.IsFalse(IsNullGuid(FirstBatchId), 'First run has a batch id');
        PostError.SetRange("Batch Id", FirstBatchId);
        Assert.AreEqual(1, PostError.Count(), 'First run records its failure');
        PostError.FindFirst();
        Assert.AreEqual(ContractNo, PostError."Contract No.", 'First run error names the contract');

        UnbindSubscription(Subscribers);
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Second run posts the contract');
        SecondBatchId := BatchPost.LastBatchId();
        Assert.IsFalse(IsNullGuid(SecondBatchId), 'Second run has a batch id');
        Assert.AreNotEqual(FirstBatchId, SecondBatchId, 'Second run gets its own batch id');
        AssertPosted(ContractNo);
        PostError.SetRange("Batch Id", SecondBatchId);
        Assert.AreEqual(0, PostError.Count(), 'Second run records no error');
        PostError.SetRange("Batch Id", FirstBatchId);
        Assert.AreEqual(1, PostError.Count(), 'First run keeps its error');
    end;

    local procedure InitBatchScenario()
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure CreateRentalVehicle(VehicleNo: Code[20])
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;

    local procedure AssertPosted(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, StrSubstNo('Contract %1 posted', ContractNo));
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), StrSubstNo('Contract %1 has one ledger entry', ContractNo));
    end;

    local procedure AssertUntouched(ContractNo: Code[20]; ExpectedStatus: Enum "CGR Rental Status")
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(ExpectedStatus, Contract.Status, StrSubstNo('Contract %1 keeps its status', ContractNo));
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), StrSubstNo('Contract %1 has no ledger entry', ContractNo));
    end;
}
