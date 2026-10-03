codeunit 85760 "HX015 Posting Preview Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PreviewMatchesPostedEntry()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        LedgerEntry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-A');
        ContractNo := ReturnedContract('HX015-A');

        RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The preview holds one ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(ContractNo, LedgerBuffer."Contract No.", 'Preview contract no.');
        Assert.AreEqual('HX015-A', LedgerBuffer."Vehicle No.", 'Preview vehicle no.');
        Assert.AreEqual(20270307D, LedgerBuffer."Posting Date", 'Preview posting date is the contract end date');
        Assert.AreEqual(135.63, LedgerBuffer.Amount, 'Preview amount is the contract price');
        Assert.AreEqual(307, LedgerBuffer."Km Driven", 'Preview km driven');

        RentalMgt.Post(ContractNo);
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'Posting creates one ledger entry');
        LedgerEntry.FindFirst();
        Assert.AreEqual(LedgerBuffer."Contract No.", LedgerEntry."Contract No.", 'Posted contract no. equals the preview');
        Assert.AreEqual(LedgerBuffer."Vehicle No.", LedgerEntry."Vehicle No.", 'Posted vehicle no. equals the preview');
        Assert.AreEqual(LedgerBuffer."Posting Date", LedgerEntry."Posting Date", 'Posted posting date equals the preview');
        Assert.AreEqual(LedgerBuffer.Amount, LedgerEntry.Amount, 'Posted amount equals the preview');
        Assert.AreEqual(LedgerBuffer."Km Driven", LedgerEntry."Km Driven", 'Posted km driven equals the preview');
    end;

    [Test]
    procedure PreviewWritesNothing()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-B');
        ContractNo := ReturnedContract('HX015-B');

        RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The preview holds one ledger entry');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The previewed contract stays returned');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry for the previewed contract');
        LedgerEntry.Reset();
        LedgerEntry.SetRange("Vehicle No.", 'HX015-B');
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry for the vehicle');
    end;

    [Test]
    procedure PreviewRunsNoPostingEvents()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        Spy: Codeunit "HX015 Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-C');
        ContractNo := ReturnedContract('HX015-C');
        Commit();
        BindSubscription(Spy);

        RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        Assert.AreEqual(0, Spy.BeforePostCount(), 'The preview does not raise OnBeforePostRentalContract');
        Assert.AreEqual(0, Spy.AfterPostCount(), 'The preview does not raise OnAfterPostRentalContract');
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The preview holds one ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(135.63, LedgerBuffer.Amount, 'Preview amount');
    end;

    [Test]
    procedure PreviewIgnoresCommittingExtension()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "HX015 Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-D');
        ContractNo := ReturnedContract('HX015-D');
        Commit();
        Spy.FailAfterCommitFor(ContractNo);
        BindSubscription(Spy);

        RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The preview holds one ledger entry');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(ContractNo, LedgerBuffer."Contract No.", 'Preview contract no.');
        Assert.AreEqual(135.63, LedgerBuffer.Amount, 'Preview amount');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The previewed contract stays returned');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry for the previewed contract');
    end;

    [Test]
    procedure PreviewReplacesBuffer()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        RentalMgt: Codeunit "CGR Rental Mgt";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-E1');
        InitVehicle('HX015-E2');
        FirstContractNo := ReturnedContract('HX015-E1');
        SecondContractNo := ReturnedContract('HX015-E2');

        RentalMgt.PreviewPosting(FirstContractNo, LedgerBuffer);
        RentalMgt.PreviewPosting(SecondContractNo, LedgerBuffer);
        Assert.AreEqual(1, LedgerBuffer.Count(), 'The second preview replaces the first');
        LedgerBuffer.FindFirst();
        Assert.AreEqual(SecondContractNo, LedgerBuffer."Contract No.", 'The buffer holds the second contract');
        Assert.AreEqual('HX015-E2', LedgerBuffer."Vehicle No.", 'The buffer holds the second vehicle');
    end;

    [Test]
    procedure PreviewOfUnreturnedContractFails()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-F');
        ContractNo := RentalMgt.CreateContract('HX015-F', 'HX015 Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);

        asserterror RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        Assert.ExpectedError(StrSubstNo('Rental contract %1 must be returned before it is posted.', ContractNo));
    end;

    [Test]
    procedure PreviewAmountAtCoarsePrecision()
    var
        LedgerBuffer: Record "CGR Rental Ledger Entry" temporary;
        LedgerEntry: Record "CGR Rental Ledger Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(1);
        InitVehicle('HX015-G');
        ContractNo := ReturnedContract('HX015-G');

        RentalMgt.PreviewPosting(ContractNo, LedgerBuffer);
        LedgerBuffer.FindFirst();
        Assert.AreEqual(135, LedgerBuffer.Amount, 'Preview amount is the sum of the rounded price lines 100 + 33 + 2');
        RentalMgt.Post(ContractNo);
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.FindFirst();
        Assert.AreEqual(135, LedgerEntry.Amount, 'Posted amount equals the preview');
    end;

    [Test]
    procedure PostingStillRunsEvents()
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "HX015 Posting Event Spy";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        InitSetup(0.01);
        InitVehicle('HX015-H');
        ContractNo := ReturnedContract('HX015-H');
        BindSubscription(Spy);

        RentalMgt.Post(ContractNo);
        Assert.AreEqual(1, Spy.BeforePostCount(), 'Posting raises OnBeforePostRentalContract once');
        Assert.AreEqual(1, Spy.AfterPostCount(), 'Posting raises OnAfterPostRentalContract once');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posting sets the contract status');
        LedgerEntry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'Posting creates one ledger entry');
        LedgerEntry.FindFirst();
        Assert.AreEqual(135.63, LedgerEntry.Amount, 'Posted amount');
    end;

    local procedure InitSetup(RoundingPrecision: Decimal)
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
        Setup."Default Branch Code" := '';
        Setup.Modify();
        SessionContext.Reset();
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

    local procedure ReturnedContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'HX015 Customer', 20270305D, 20270307D);
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1307, '');
        exit(ContractNo);
    end;
}
