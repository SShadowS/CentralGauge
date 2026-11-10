codeunit 80650 "CGR Cancel Contract Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        Cancellation: Codeunit "CGR Contract Cancellation";
        Reporting: Codeunit "CGR Cancellation Reporting";

    [Test]
    procedure WaivedCancellationCountsNowhere()
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        // Whole-fee window, so a charged fee would be visible.
        ContractNo := H158Contract('H158-V01', 'H158A', 40);

        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270228D, true), 'A waived cancellation returns true');

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'A waived cancellation keeps its entry');
        Entry.FindFirst();
        Assert.IsTrue(Entry.Waived, 'The entry is marked waived');
        Assert.AreEqual('H158A', Entry."Branch Code", 'Branch Code of the contract');
        Assert.AreEqual(0, Entry."Fee Amount", 'A waived fee is 0');
        AssertMoneyRows(ContractNo, 0, 0);
        AssertBranch('H158A', 0, 0);
    end;

    [Test]
    procedure FreeUnderTheSevenDayRuleStillCounts()
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := H158Contract('H158-V02', 'H158B', 40);

        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270222D, false), 'Exactly 7 days before returns true');

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One entry');
        Entry.FindFirst();
        Assert.IsFalse(Entry.Waived, 'Not waived');
        Assert.AreEqual(0, Entry."Fee Amount", 'Exactly 7 days before is free');
        AssertMoneyRows(ContractNo, 1, 0);
        AssertBranch('H158B', 0, 1);
    end;

    [Test]
    procedure LateCancellationChargesTheWholeValue()
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := H158Contract('H158-V03', 'H158C', 40);

        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270227D, false), 'Returns true');

        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.AreEqual(120, Entry."Fee Amount", '2 days before: whole value of 3 days x 40');
        AssertMoneyRows(ContractNo, 1, 120);
        AssertBranch('H158C', 120, 1);
    end;

    [Test]
    procedure ThreeDaysBeforeChargesHalfRounded()
    begin
        AssertHalfFee('H158-V04', 'H158D', 20270226D);
    end;

    [Test]
    procedure SixDaysBeforeChargesHalfRounded()
    begin
        AssertHalfFee('H158-V05', 'H158E', 20270223D);
    end;

    [Test]
    procedure ContractIsCancelledOnce()
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := H158Contract('H158-V06', 'H158F', 40);

        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270227D, false), 'The first call returns true');
        Commit();
        Assert.IsFalse(Cancellation.CancelContract(ContractNo, 20270227D, false), 'The second call returns false');

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'A contract is cancelled once');
        AssertMoneyRows(ContractNo, 1, 120);
    end;

    [Test]
    procedure OnlyAnOpenContractIsCancelled()
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := H158Contract('H158-V07', 'H158G', 40);
        Contract.Get(ContractNo);
        Contract.Status := Contract.Status::"Checked Out";
        Contract.Modify();

        Commit();
        Assert.IsFalse(Cancellation.CancelContract(ContractNo, 20270227D, false), 'A contract that is not Open is not cancelled');

        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry');
        AssertMoneyRows(ContractNo, 0, 0);
    end;

    [Test]
    procedure RefusedCancellationKeepsOnlyTheFailure()
    var
        Entry: Record "CGR Cancellation Entry";
        Failure: Record "CGR Cancellation Failure";
        Spy: Codeunit "CGR Cancellation Partner Spy";
        ContractNo: Code[20];
        Cancelled: Boolean;
    begin
        ContractNo := H158Contract('H158-V08', 'H158H', 40);
        Spy.RefuseCancellationOf(ContractNo);
        BindSubscription(Spy);

        Commit();
        Cancelled := Cancellation.CancelContract(ContractNo, 20270227D, false);
        UnbindSubscription(Spy);

        Assert.IsFalse(Cancelled, 'A refused cancellation returns false');
        Failure.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Failure.Count(), 'One failure row');
        Failure.FindFirst();
        Assert.AreEqual(Spy.ExpectedRefusalText(ContractNo), Failure."Error Message", 'The partner error text');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Entry.Count(), 'No entry is kept');
        AssertMoneyRows(ContractNo, 0, 0);
        AssertBranch('H158H', 0, 0);
    end;

    local procedure AssertHalfFee(VehicleNo: Code[20]; BranchCode: Code[10]; CancelDate: Date)
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := H158Contract(VehicleNo, BranchCode, 33.33);

        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, CancelDate, false), 'Returns true');

        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.AreEqual(50, Entry."Fee Amount", 'Half of 99.99, rounded to 0.01');
        AssertMoneyRows(ContractNo, 1, 50);
        AssertBranch(BranchCode, 50, 1);
    end;

    local procedure AssertMoneyRows(ContractNo: Code[20]; ExpectedRows: Integer; ExpectedAmount: Decimal)
    var
        Ledger: Record "CGR Rental Ledger Entry";
        Notice: Record "CGR Cancellation Message";
    begin
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(ExpectedRows, Ledger.Count(), 'Ledger entries of the contract');
        Notice.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(ExpectedRows, Notice.Count(), 'Partner messages of the contract');
        if ExpectedRows = 0 then
            exit;
        Ledger.FindFirst();
        Assert.AreEqual(ExpectedAmount, Ledger.Amount, 'Ledger Amount is the fee');
        Notice.FindFirst();
        Assert.AreEqual(ExpectedAmount, Notice."Fee Amount", 'Message carries the fee');
    end;

    local procedure AssertBranch(BranchCode: Code[10]; ExpectedFee: Decimal; ExpectedCount: Integer)
    var
        FeeTotal: Decimal;
        Cancellations: Integer;
    begin
        Reporting.BranchTotals(BranchCode, FeeTotal, Cancellations);
        Assert.AreEqual(ExpectedCount, Cancellations, 'BranchTotals count');
        Assert.AreEqual(ExpectedFee, FeeTotal, 'BranchTotals fee');
    end;

    local procedure H158Contract(VehicleNo: Code[20]; BranchCode: Code[10]; DailyRate: Decimal): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Cancellation Entry";
        Ledger: Record "CGR Rental Ledger Entry";
        Notice: Record "CGR Cancellation Message";
        Failure: Record "CGR Cancellation Failure";
        ContractNo: Code[20];
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, 'H158Z', 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, DailyRate);
        ContractNo := Lib.CreateContract(VehicleNo);
        Contract.Get(ContractNo);
        Contract."Branch Code" := BranchCode;
        Contract.Modify();
        Entry.SetRange("Branch Code", BranchCode);
        Entry.DeleteAll();
        Entry.Reset();
        Entry.SetRange("Contract No.", ContractNo);
        Entry.DeleteAll();
        Ledger.SetRange("Contract No.", ContractNo);
        Ledger.DeleteAll();
        Notice.SetRange("Contract No.", ContractNo);
        Notice.DeleteAll();
        Failure.SetRange("Contract No.", ContractNo);
        Failure.DeleteAll();
        exit(ContractNo);
    end;
}
