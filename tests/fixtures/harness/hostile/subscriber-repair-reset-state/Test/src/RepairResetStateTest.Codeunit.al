codeunit 84892 "CGR Repair Reset State Test"
{
    // H-35 Phase 3 subscriber-repair (reset-state): passes only while the
    // agent's FailBeforePost subscriber in 80090 is bound (build A). Build G
    // has the pristine 80090, so the shipped batch post test fails there.
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure CommittingFailureLeavesContractReturned()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270401D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-HR-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-HR-001', 40);
        ContractNo := Lib.CreateReturnedContract('T-HR-001', 20270401D, 20270402D, 1100);
        Lib.FailPostingAfterCommit(ContractNo);
        BindSubscription(Lib);

        Contract.SetRange("Vehicle No.", 'T-HR-001');
        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'Nothing is posted');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The contract stays returned');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(1, PostError.Count(), 'One error logged');
    end;
}
