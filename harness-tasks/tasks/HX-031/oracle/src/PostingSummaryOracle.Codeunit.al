// Every row reads the figures through a fresh "CGR Posting Summary" variable before and after its act and
// asserts deltas: single-instance figures outlive a procedure within one codeunit run, so no row depends on
// the figures other rows left behind or on ResetSummary. Every write is committed before a posting call,
// because a return-value Codeunit.Run raises with an uncommitted write pending (P-W3-8).
codeunit 86080 "HX031 Posting Summary Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SinglePostCounted()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
    begin
        Prepare();
        InitVehicle('HX031-V1A', 50);
        ReturnedContract('HX031-C1A', 'HX031-V1A');
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        RentalMgt.Post('HX031-C1A');
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.AreEqual(1, PostedAfter - PostedBefore, 'A contract posted through Post counts as posted');
        Assert.AreEqual(150.00, AmountAfter - AmountBefore, 'The posted amount is the amount of its ledger entry (3 x 50)');
        Assert.AreEqual(0, FailedAfter - FailedBefore, 'A posted contract does not count as failed');
    end;

    [Test]
    procedure BatchPostCounted()
    var
        Contract: Record "CGR Rental Contract";
        BatchPost: Codeunit "CGR Rental Batch Post";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
    begin
        Prepare();
        InitVehicle('HX031-V2B', 50);
        InitVehicle('HX031-V2C', 70);
        ReturnedContract('HX031-C2B', 'HX031-V2B');
        ReturnedContract('HX031-C2C', 'HX031-V2C');
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        Contract.SetFilter("No.", '%1|%2', 'HX031-C2B', 'HX031-C2C');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'PostBatch returns the number posted');
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.AreEqual(2, PostedAfter - PostedBefore, 'Both batch-posted contracts count as posted');
        Assert.AreEqual(360.00, AmountAfter - AmountBefore, 'Posted amount 3 x 50 + 3 x 70');
        Assert.AreEqual(0, FailedAfter - FailedBefore, 'No batch-posted contract counts as failed');
    end;

    [Test]
    procedure RefusedBatchContractCountsFailed()
    var
        Contract: Record "CGR Rental Contract";
        Refusal: Codeunit "HX031 Posting Refusal";
        BatchPost: Codeunit "CGR Rental Batch Post";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
    begin
        Prepare();
        InitVehicle('HX031-V3B', 50);
        InitVehicle('HX031-V3C', 50);
        ReturnedContract('HX031-C3B', 'HX031-V3B');
        ReturnedContract('HX031-C3C', 'HX031-V3C');
        Refusal.RefuseContract('HX031-C3C');
        BindSubscription(Refusal);
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        Contract.SetFilter("No.", '%1|%2', 'HX031-C3B', 'HX031-C3C');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'PostBatch posts only the contract that is not refused');
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.AreEqual(1, PostedAfter - PostedBefore, 'Only the contract actually posted counts as posted');
        Assert.AreEqual(150.00, AmountAfter - AmountBefore, 'The refused contract adds no amount');
        Assert.AreEqual(1, FailedAfter - FailedBefore, 'The refused contract counts as failed');
    end;

    [Test]
    procedure RefusedSinglePostCountsFailed()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Refusal: Codeunit "HX031 Posting Refusal";
        Runner: Codeunit "HX031 Post Runner";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
        Ok: Boolean;
    begin
        Prepare();
        InitVehicle('HX031-V4A', 50);
        ReturnedContract('HX031-C4A', 'HX031-V4A');
        Refusal.RefuseContract('HX031-C4A');
        BindSubscription(Refusal);
        Runner.PostContract('HX031-C4A');
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        Ok := Runner.Run();
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.IsFalse(Ok, 'Post raises the refusal to its caller');
        Assert.AreEqual('HX031 refuses HX031-C4A.', GetLastErrorText(), 'Post raises the posting''s own error');
        Assert.AreEqual(0, PostedAfter - PostedBefore, 'A refused contract does not count as posted');
        Assert.AreEqual(0.0, AmountAfter - AmountBefore, 'A refused contract adds no amount');
        Assert.AreEqual(1, FailedAfter - FailedBefore, 'A refused contract counts as failed, also when Post raised the error');
        Contract.Get('HX031-C4A');
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The refused contract stays returned');
        LedgerEntry.SetRange("Contract No.", 'HX031-C4A');
        Assert.AreEqual(0, LedgerEntry.Count(), 'The refused contract keeps no ledger entry');
    end;

    [Test]
    procedure UnreturnedContractCountsFailed()
    var
        Runner: Codeunit "HX031 Post Runner";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
        Ok: Boolean;
    begin
        Prepare();
        InitVehicle('HX031-V5D', 50);
        OpenContract('HX031-C5D', 'HX031-V5D');
        Runner.PostContract('HX031-C5D');
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        Ok := Runner.Run();
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.IsFalse(Ok, 'Posting an open contract fails');
        Assert.AreEqual('Rental contract HX031-C5D must be returned before it is posted.', GetLastErrorText(), 'Post raises the posting''s own error');
        Assert.AreEqual(1, FailedAfter - FailedBefore, 'A contract posted with the wrong status counts as failed');
        Assert.AreEqual(0, PostedAfter - PostedBefore, 'A contract posted with the wrong status does not count as posted');
    end;

    [Test]
    procedure PostRightAfterReturnKeepsPostingError()
    var
        Refusal: Codeunit "HX031 Posting Refusal";
        Runner: Codeunit "HX031 Post Runner";
        PostedBefore, PostedAfter, FailedBefore, FailedAfter : Integer;
        AmountBefore, AmountAfter : Decimal;
        Ok: Boolean;
    begin
        Prepare();
        InitVehicle('HX031-V6E', 50);
        CheckedOutContract('HX031-C6E', 'HX031-V6E');
        Refusal.RefuseContract('HX031-C6E');
        BindSubscription(Refusal);
        Runner.ReturnAndPostContract('HX031-C6E');
        Commit();

        ReadFigures(PostedBefore, AmountBefore, FailedBefore);
        Ok := Runner.Run();
        ReadFigures(PostedAfter, AmountAfter, FailedAfter);

        Assert.IsFalse(Ok, 'Post raises the refusal to its caller');
        Assert.AreEqual('HX031 refuses HX031-C6E.', GetLastErrorText(), 'Post right after the return raises the posting''s own error');
        Assert.AreEqual(1, FailedAfter - FailedBefore, 'A contract refused right after its return counts as failed');
    end;

    [Test]
    procedure FiguresSharedAcrossInstances()
    var
        SummaryOne: Codeunit "CGR Posting Summary";
        SummaryTwo: Codeunit "CGR Posting Summary";
        RentalMgt: Codeunit "CGR Rental Mgt";
        OneBefore: Integer;
        TwoBefore: Integer;
    begin
        Prepare();
        InitVehicle('HX031-V7A', 50);
        ReturnedContract('HX031-C7A', 'HX031-V7A');
        Commit();

        OneBefore := SummaryOne.PostedCount();
        TwoBefore := SummaryTwo.PostedCount();
        RentalMgt.Post('HX031-C7A');

        Assert.AreEqual(1, SummaryOne.PostedCount() - OneBefore, 'A summary variable declared before the posting sees it');
        Assert.AreEqual(1, SummaryTwo.PostedCount() - TwoBefore, 'A second summary variable sees the same posting');
    end;

    [Test]
    procedure ResetClearsFigures()
    var
        Contract: Record "CGR Rental Contract";
        Refusal: Codeunit "HX031 Posting Refusal";
        Runner: Codeunit "HX031 Post Runner";
        BatchPost: Codeunit "CGR Rental Batch Post";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SummaryOne: Codeunit "CGR Posting Summary";
        SummaryTwo: Codeunit "CGR Posting Summary";
        Ok: Boolean;
    begin
        Prepare();
        InitVehicle('HX031-V8A', 50);
        InitVehicle('HX031-V8D', 50);
        InitVehicle('HX031-V8F', 50);
        ReturnedContract('HX031-C8A', 'HX031-V8A');
        OpenContract('HX031-C8D', 'HX031-V8D');
        ReturnedContract('HX031-C8F', 'HX031-V8F');
        Refusal.RefuseContract('HX031-C8F');
        BindSubscription(Refusal);
        Runner.PostContract('HX031-C8D');
        Commit();

        // A failure through Post, a failure through PostBatch and a posting through Post, so that
        // every figure is non-zero before the reset in every design that counts them at all.
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'Posting the open contract fails');
        Contract.SetRange("No.", 'HX031-C8F');
        Assert.AreEqual(0, BatchPost.PostBatch(Contract), 'The refused contract is not posted');
        Commit();
        RentalMgt.Post('HX031-C8A');
        Assert.IsTrue(SummaryTwo.PostedCount() > 0, 'The posting is counted before the reset');
        Assert.IsTrue(SummaryTwo.PostedAmount() > 0, 'The posted amount is non-zero before the reset');
        Assert.IsTrue(SummaryTwo.FailedCount() > 0, 'The failures are counted before the reset');

        SummaryOne.ResetSummary();

        Assert.AreEqual(0, SummaryTwo.PostedCount(), 'ResetSummary sets the posted count to zero');
        Assert.AreEqual(0.0, SummaryTwo.PostedAmount(), 'ResetSummary sets the posted amount to zero');
        Assert.AreEqual(0, SummaryTwo.FailedCount(), 'ResetSummary sets the failed count to zero');
    end;

    local procedure ReadFigures(var Posted: Integer; var Amount: Decimal; var Failed: Integer)
    var
        Summary: Codeunit "CGR Posting Summary";
    begin
        Posted := Summary.PostedCount();
        Amount := Summary.PostedAmount();
        Failed := Summary.FailedCount();
    end;

    // Work date and Setup per procedure (pricing 0 % weekend, 1000 km a day, no excess rate; precision
    // 0.01, no default branch, 3 outbox attempts), then the session Setup cache is dropped.
    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
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

    local procedure OpenContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.DeleteAll();
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX031 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Status := Contract.Status::Open;
        Contract.Insert();
    end;

    local procedure CheckedOutContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        OpenContract(ContractNo, VehicleNo);
        RentalMgt.CheckOut(ContractNo);
    end;

    local procedure ReturnedContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        CheckedOutContract(ContractNo, VehicleNo);
        RentalMgt.Return(ContractNo, 1100, '');
    end;
}
