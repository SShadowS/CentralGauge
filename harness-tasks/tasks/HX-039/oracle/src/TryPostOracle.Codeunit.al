codeunit 86240 "HX039 Try Post Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        ReturnedFalseTxt: Label 'HX039 TryPost returned false: %1', Locked = true;
        ReturnedFalsePrefixTxt: Label 'HX039 TryPost returned false:', Locked = true;
        RefusedTxt: Label 'HX039 refuses %1.', Locked = true;
        NotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;

    [Test]
    procedure TryPostPostsReturnedContract()
    var
        Runner: Codeunit "HX039 Try Post Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        InitVehicle('HX039-1A');
        ContractNo := ReturnedContract('HX039-1A');
        Commit();

        Runner.SetContract(ContractNo, false);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'TryPost returns true for a returned contract and raises nothing: ' + GetLastErrorText());
        AssertPosted(ContractNo, 150.00, 'Returned contract');
    end;

    [Test]
    procedure RefusedContractReturnsFalse()
    var
        Refusal: Codeunit "HX039 Posting Refusal";
        Runner: Codeunit "HX039 Try Post Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        InitVehicle('HX039-2A');
        ContractNo := ReturnedContract('HX039-2A');
        Refusal.RefuseContract(ContractNo, false);
        BindSubscription(Refusal);
        Commit();

        Runner.SetContract(ContractNo, false);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The runner fails only because TryPost returned false');
        Assert.AreEqual(StrSubstNo(ReturnedFalseTxt, StrSubstNo(RefusedTxt, ContractNo)), GetLastErrorText(), 'TryPost returns false, raises nothing and keeps the posting''s error text');
        AssertReturnedUnposted(ContractNo, 1100, 'Refused contract');
    end;

    [Test]
    procedure CommittingRefusalLeavesNothing()
    var
        Refusal: Codeunit "HX039 Posting Refusal";
        Runner: Codeunit "HX039 Try Post Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        InitVehicle('HX039-3A');
        ContractNo := ReturnedContract('HX039-3A');
        Refusal.RefuseContract(ContractNo, true);
        BindSubscription(Refusal);
        Commit();

        Runner.SetContract(ContractNo, false);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The runner fails only because TryPost returned false');
        Assert.AreEqual(StrSubstNo(ReturnedFalseTxt, StrSubstNo(RefusedTxt, ContractNo)), GetLastErrorText(), 'TryPost returns false with the posting''s error text');
        AssertReturnedUnposted(ContractNo, 1100, 'Contract whose extension committed before refusing');
    end;

    [Test]
    procedure TryPostRightAfterReturn()
    var
        Refusal: Codeunit "HX039 Posting Refusal";
        Runner: Codeunit "HX039 Try Post Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        InitVehicle('HX039-4B');
        ContractNo := RentalMgt.CreateContract('HX039-4B', 'HX039 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        Refusal.RefuseContract(ContractNo, false);
        BindSubscription(Refusal);
        Commit();

        Runner.SetContract(ContractNo, true);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The runner fails only because TryPost returned false');
        Assert.AreEqual(StrSubstNo(ReturnedFalseTxt, StrSubstNo(RefusedTxt, ContractNo)), GetLastErrorText(), 'TryPost right after the return returns false with the posting''s error text');
        AssertReturnedUnposted(ContractNo, 1100, 'Contract returned just before TryPost');
    end;

    [Test]
    procedure OpenContractReturnsFalse()
    var
        Runner: Codeunit "HX039 Try Post Runner";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        InitVehicle('HX039-5C');
        ContractNo := RentalMgt.CreateContract('HX039-5C', 'HX039 Customer', 20270301D, 20270303D);
        Commit();

        Runner.SetContract(ContractNo, false);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The runner fails only because TryPost returned false');
        Assert.AreEqual(StrSubstNo(ReturnedFalseTxt, StrSubstNo(NotReturnedTxt, ContractNo)), GetLastErrorText(), 'TryPost returns false with the posting''s error text');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The open contract stays open');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'The open contract has no ledger entry');
    end;

    [Test]
    procedure MissingContractReturnsFalse()
    var
        Runner: Codeunit "HX039 Try Post Runner";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        InitRun();
        ContractNo := 'HX039-MISSING';
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.DeleteAll();
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Commit();

        Runner.SetContract(ContractNo, false);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The runner fails only because TryPost returned false');
        Assert.IsTrue(GetLastErrorText().StartsWith(ReturnedFalsePrefixTxt), 'TryPost returns false and raises nothing for a contract that does not exist, got: ' + GetLastErrorText());
        Assert.IsFalse(Contract.Get(ContractNo), 'TryPost creates no contract');
        Assert.AreEqual(0, LedgerEntry.Count(), 'The missing contract has no ledger entry');
    end;

    [Test]
    procedure BatchSkipsCommittingRefusal()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        Refusal: Codeunit "HX039 Posting Refusal";
        BatchPost: Codeunit "CGR Rental Batch Post";
        GoodContractNo: Code[20];
        RefusedContractNo: Code[20];
    begin
        InitRun();
        InitVehicle('HX039-6D');
        InitVehicle('HX039-6E');
        GoodContractNo := ReturnedContract('HX039-6D');
        RefusedContractNo := ReturnedContract('HX039-6E');
        Refusal.RefuseContract(RefusedContractNo, true);
        BindSubscription(Refusal);

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX039-6D', 'HX039-6E');
        Assert.AreEqual(1, BatchPost.PostBatch(Contract), 'Only the accepted contract is posted');

        AssertPosted(GoodContractNo, 150.00, 'Accepted contract');
        AssertReturnedUnposted(RefusedContractNo, 1100, 'Contract whose extension committed before refusing');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(1, PostError.Count(), 'One error logged for the batch');
        PostError.FindFirst();
        Assert.AreEqual(RefusedContractNo, PostError."Contract No.", 'The error names the refused contract');
        Assert.AreEqual(StrSubstNo(RefusedTxt, RefusedContractNo), PostError."Error Message", 'The logged error is the posting''s error text');
    end;

    [Test]
    procedure BatchPostsEveryReturned()
    var
        Contract: Record "CGR Rental Contract";
        PostError: Record "CGR Batch Post Error";
        BatchPost: Codeunit "CGR Rental Batch Post";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        InitRun();
        InitVehicle('HX039-7F');
        InitVehicle('HX039-7G');
        FirstContractNo := ReturnedContract('HX039-7F');
        SecondContractNo := ReturnedContract('HX039-7G');

        Contract.SetFilter("Vehicle No.", '%1|%2', 'HX039-7F', 'HX039-7G');
        Assert.AreEqual(2, BatchPost.PostBatch(Contract), 'Both returned contracts are posted');

        AssertPosted(FirstContractNo, 150.00, 'First contract');
        AssertPosted(SecondContractNo, 150.00, 'Second contract');
        PostError.SetRange("Batch Id", BatchPost.LastBatchId());
        Assert.AreEqual(0, PostError.Count(), 'No error logged for the batch');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Suspend Rentals" := false;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 50;
        Vehicle.Insert();
    end;

    local procedure ReturnedContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX039 Customer', 20270301D, 20270303D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1100, '');
        exit(ContractNo);
    end;

    local procedure AssertPosted(ContractNo: Code[20]; ExpectedAmount: Decimal; What: Text)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, What + ' is posted');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), What + ' has one ledger entry');
        LedgerEntry.FindFirst();
        Assert.AreEqual(ExpectedAmount, LedgerEntry.Amount, What + ' ledger amount, 3 days x 50');
    end;

    local procedure AssertReturnedUnposted(ContractNo: Code[20]; ExpectedReturnKm: Integer; What: Text)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, What + ' stays returned');
        Assert.AreEqual(ExpectedReturnKm, Contract."Return Km", What + ' keeps its return km');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), What + ' has no ledger entry');
    end;
}
