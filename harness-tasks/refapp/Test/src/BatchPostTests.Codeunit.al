codeunit 80054 "CGR Batch Post Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PostsEveryReturnedContractInFilter()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
        OpenContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-BP-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('T-BP-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('T-BP-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-BP-001', 50);
        Lib.SetDailyRate('T-BP-002', 60);
        FirstContractNo := Lib.CreateReturnedContract('T-BP-001', 20270301D, 20270303D, 1100);
        SecondContractNo := Lib.CreateReturnedContract('T-BP-002', 20270301D, 20270303D, 1100);
        OpenContractNo := Lib.CreateContract('T-BP-003');

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BP-001', 'T-BP-002', 'T-BP-003');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'Both returned contracts are posted');

        Contract.Get(FirstContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'First contract posted');
        Contract.Get(SecondContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Second contract posted');
        Contract.Get(OpenContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'An open contract is not posted');
        LedgerEntry.SetRange("Contract No.", SecondContractNo);
        LedgerEntry.FindFirst();
        Assert.AreEqual(180.00, LedgerEntry.Amount, '3 days x 60');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No error logged');
    end;

    [Test]
    procedure FailedContractIsRolledBackAndLogged()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodContractNo: Code[20];
        FailingContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-BP-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('T-BP-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-BP-004', 50);
        Lib.SetDailyRate('T-BP-005', 50);
        GoodContractNo := Lib.CreateReturnedContract('T-BP-004', 20270301D, 20270303D, 1100);
        FailingContractNo := Lib.CreateReturnedContract('T-BP-005', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(FailingContractNo);
        BindSubscription(Subscribers);

        Contract.SetFilter("Vehicle No.", '%1|%2', 'T-BP-004', 'T-BP-005');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Only the good contract is posted');

        Contract.Get(GoodContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Good contract posted');
        LedgerEntry.SetRange("Contract No.", GoodContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'Good contract has its ledger entry');

        Contract.Get(FailingContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Failing contract stays returned');
        LedgerEntry.SetRange("Contract No.", FailingContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'Failing contract has no ledger entry');

        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(1, PostError.Count(), 'One error logged');
        PostError.FindFirst();
        Assert.AreEqual(FailingContractNo, PostError."Contract No.", 'Error names the failing contract');
        Assert.AreEqual(StrSubstNo('Simulated failure after commit for %1.', FailingContractNo), PostError."Error Message", 'Error text');
    end;
}
