codeunit 80077 "CGR Batch Post Run Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure SecondRunGetsNewBatchId()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
        FirstBatchId: Guid;
    begin
        PrepareNaiveRun();
        CreateNaiveVehicle('T-BRN-001');
        ContractNo := Lib.CreateReturnedContract('T-BRN-001', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(ContractNo);
        BindSubscription(Subscribers);
        Contract.SetRange("Vehicle No.", 'T-BRN-001');

        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'First run fails');
        FirstBatchId := BatchPost.LastBatchId();
        PostError.SetRange("Batch Id", FirstBatchId);
        Assert.AreEqual(1, PostError.Count(), 'First run logs the failure');

        UnbindSubscription(Subscribers);
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Second run posts');
        Assert.AreNotEqual(FirstBatchId, BatchPost.LastBatchId(), 'New batch id');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'Second run shows no errors');
    end;

    [Test]
    procedure PostsReturnedContracts()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FirstNo: Code[20];
        SecondNo: Code[20];
        OpenNo: Code[20];
    begin
        PrepareNaiveRun();
        CreateNaiveVehicle('T-BRN-002');
        CreateNaiveVehicle('T-BRN-003');
        CreateNaiveVehicle('T-BRN-004');
        FirstNo := Lib.CreateReturnedContract('T-BRN-002', 20270301D, 20270303D, 1100);
        SecondNo := Lib.CreateReturnedContract('T-BRN-003', 20270301D, 20270303D, 1100);
        OpenNo := Lib.CreateContract('T-BRN-004');

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BRN-002', 'T-BRN-003', 'T-BRN-004');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'Both returned contracts posted');

        Contract.Get(FirstNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'First posted');
        Contract.Get(SecondNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Second posted');
        Contract.Get(OpenNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open contract not posted');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No errors');
    end;

    [Test]
    procedure FailedContractIsLogged()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FailingNo: Code[20];
    begin
        PrepareNaiveRun();
        CreateNaiveVehicle('T-BRN-005');
        FailingNo := Lib.CreateReturnedContract('T-BRN-005', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(FailingNo);
        BindSubscription(Subscribers);

        Contract.SetRange("Vehicle No.", 'T-BRN-005');
        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'Nothing posted');

        Contract.Get(FailingNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Failing contract stays returned');
        LedgerEntry.SetRange("Contract No.", FailingNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(1, PostError.Count(), 'One error logged');
        PostError.FindFirst();
        Assert.AreEqual(FailingNo, PostError."Contract No.", 'Error names the contract');
        Assert.AreEqual(StrSubstNo('Simulated failure after commit for %1.', FailingNo), PostError."Error Message", 'Error text');
    end;

    local procedure PrepareNaiveRun()
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure CreateNaiveVehicle(VehicleNo: Code[20])
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;
}
