codeunit 84894 "CGR Repair Is Handled Test"
{
    // H-35 Phase 3 subscriber-repair (is-handled): passes only while the
    // agent's LogErrorText subscriber in 80090 is bound (build A). Build G
    // has the pristine 80090, so the shipped error text check fails there.
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FailedBatchLogsTheErrorText()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        ContractNo: Code[20];
    begin
        WorkDate(20270401D);
        Lib.SetPricing(0, 1000, 0);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-HR-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate('T-HR-003', 40);
        ContractNo := Lib.CreateReturnedContract('T-HR-003', 20270401D, 20270402D, 1100);
        Lib.FailPostingAfterCommit(ContractNo);
        BindSubscription(Lib);

        Contract.SetRange("Vehicle No.", 'T-HR-003');
        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'Nothing is posted');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        PostError.FindFirst();
        Assert.AreEqual(StrSubstNo('Simulated failure after commit for %1.', ContractNo), PostError."Error Message", 'The error text is logged');
    end;
}
