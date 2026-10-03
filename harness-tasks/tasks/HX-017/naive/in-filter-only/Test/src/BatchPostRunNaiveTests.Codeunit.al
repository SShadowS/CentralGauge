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
        CreateNaiveVehicle('T-BRN-011');
        ContractNo := Lib.CreateReturnedContract('T-BRN-011', 20270301D, 20270303D, 1100);
        Subscribers.FailPostingAfterCommit(ContractNo);
        BindSubscription(Subscribers);
        Contract.SetRange("Vehicle No.", 'T-BRN-011');

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
    procedure ReturnedOnlyPosted()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ReturnedNo: Code[20];
        OpenNo: Code[20];
        CheckedOutNo: Code[20];
    begin
        PrepareNaiveRun();
        CreateNaiveVehicle('T-BRN-012');
        CreateNaiveVehicle('T-BRN-013');
        CreateNaiveVehicle('T-BRN-014');
        ReturnedNo := Lib.CreateReturnedContract('T-BRN-012', 20270301D, 20270303D, 1100);
        OpenNo := Lib.CreateContract('T-BRN-013');
        CheckedOutNo := Lib.CreateContract('T-BRN-014');
        RentalMgt.CheckOut(CheckedOutNo);

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BRN-012', 'T-BRN-013', 'T-BRN-014');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Only the returned contract is posted');

        Contract.Get(ReturnedNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Returned contract posted');
        Contract.Get(OpenNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open contract not posted');
        Contract.Get(CheckedOutNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Checked out contract not posted');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No errors');
    end;

    [Test]
    procedure FailuresLoggedAndRunContinues()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        PostError: Record "CGR Batch Post Error";
        Subscribers: Codeunit "CGR Test Library";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FailingNo: Code[20];
        NoVehicleNo: Code[20];
        GoodNo: Code[20];
    begin
        PrepareNaiveRun();
        CreateNaiveVehicle('T-BRN-015');
        CreateNaiveVehicle('T-BRN-016');
        CreateNaiveVehicle('T-BRN-017');
        FailingNo := Lib.CreateReturnedContract('T-BRN-015', 20270301D, 20270303D, 1100);
        NoVehicleNo := Lib.CreateReturnedContract('T-BRN-016', 20270301D, 20270303D, 1100);
        GoodNo := Lib.CreateReturnedContract('T-BRN-017', 20270301D, 20270303D, 1100);
        Vehicle.Get('T-BRN-016');
        Vehicle.Delete();
        Subscribers.FailPostingAfterCommit(FailingNo);
        BindSubscription(Subscribers);

        Contract.SetFilter("Vehicle No.", '%1|%2|%3', 'T-BRN-015', 'T-BRN-016', 'T-BRN-017');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Good contract posted');

        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Good contract posted');
        Contract.Get(FailingNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Failing contract stays returned');
        LedgerEntry.SetRange("Contract No.", FailingNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry for the failing contract');
        Contract.Get(NoVehicleNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract without vehicle stays returned');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(2, PostError.Count(), 'Two errors logged');
        PostError.SetRange("Contract No.", FailingNo);
        PostError.FindFirst();
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
