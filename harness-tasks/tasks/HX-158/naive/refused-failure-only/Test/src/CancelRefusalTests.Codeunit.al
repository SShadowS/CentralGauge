codeunit 80654 "CGR Cancel Refusal Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        Cancellation: Codeunit "CGR Contract Cancellation";
        Reporting: Codeunit "CGR Cancellation Reporting";

    [Test]
    procedure WaivedIsInvisibleToTheMoney()
    var
        Entry: Record "CGR Cancellation Entry";
        Ledger: Record "CGR Rental Ledger Entry";
        Notice: Record "CGR Cancellation Message";
        ContractNo: Code[20];
        FeeTotal: Decimal;
        Cancellations: Integer;
    begin
        ContractNo := RefusalContract('H158-N31', 'H158M');
        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270228D, true), 'Waived returns true');
        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.IsTrue(Entry.Waived, 'Waived set');
        Assert.AreEqual(0, Entry."Fee Amount", 'No fee');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Ledger.Count(), 'No ledger entry');
        Notice.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(0, Notice.Count(), 'No message');
        Reporting.BranchTotals('H158M', FeeTotal, Cancellations);
        Assert.AreEqual(0, Cancellations, 'Not counted');
    end;

    [Test]
    procedure SevenDayFreeIsStillBooked()
    var
        Entry: Record "CGR Cancellation Entry";
        Ledger: Record "CGR Rental Ledger Entry";
        Notice: Record "CGR Cancellation Message";
        ContractNo: Code[20];
        FeeTotal: Decimal;
        Cancellations: Integer;
    begin
        ContractNo := RefusalContract('H158-N32', 'H158N');
        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270222D, false), 'Returns true');
        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.AreEqual(0, Entry."Fee Amount", 'Free at 7 days');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'One ledger entry');
        Notice.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Notice.Count(), 'One message');
        Reporting.BranchTotals('H158N', FeeTotal, Cancellations);
        Assert.AreEqual(1, Cancellations, 'Counted');
    end;

    [Test]
    procedure RefusalRecordsTheFailure()
    var
        Failure: Record "CGR Cancellation Failure";
        Spy: Codeunit "CGR Cancel Refusal Spy";
        ContractNo: Code[20];
        Cancelled: Boolean;
    begin
        ContractNo := RefusalContract('H158-N33', 'H158O');
        Spy.RefuseContract(ContractNo);
        BindSubscription(Spy);
        Commit();
        Cancelled := Cancellation.CancelContract(ContractNo, 20270227D, false);
        UnbindSubscription(Spy);
        Assert.IsFalse(Cancelled, 'Refused returns false');
        Failure.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Failure.Count(), 'One failure row');
    end;

    local procedure RefusalContract(VehicleNo: Code[20]; BranchCode: Code[10]): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        ContractNo: Code[20];
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, 'H158Z', 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 40);
        ContractNo := Lib.CreateContract(VehicleNo);
        Contract.Get(ContractNo);
        Contract."Branch Code" := BranchCode;
        Contract.Modify();
        exit(ContractNo);
    end;
}
