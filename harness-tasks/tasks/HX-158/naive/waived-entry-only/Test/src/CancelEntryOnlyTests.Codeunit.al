codeunit 80652 "CGR Cancel Entry Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        Cancellation: Codeunit "CGR Contract Cancellation";
        Reporting: Codeunit "CGR Cancellation Reporting";

    [Test]
    procedure WaivedKeepsAnEntryWithoutFee()
    var
        Entry: Record "CGR Cancellation Entry";
        ContractNo: Code[20];
    begin
        ContractNo := EntryOnlyContract('H158-N11', 'H158I');
        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270228D, true), 'Waived returns true');
        Entry.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Entry.Count(), 'One entry');
        Entry.FindFirst();
        Assert.IsTrue(Entry.Waived, 'Waived set');
        Assert.AreEqual(0, Entry."Fee Amount", 'No fee');
    end;

    [Test]
    procedure SevenDayFreeCancellationIsRecorded()
    var
        Entry: Record "CGR Cancellation Entry";
        Ledger: Record "CGR Rental Ledger Entry";
        Notice: Record "CGR Cancellation Message";
        ContractNo: Code[20];
        FeeTotal: Decimal;
        Cancellations: Integer;
    begin
        ContractNo := EntryOnlyContract('H158-N12', 'H158J');
        Commit();
        Assert.IsTrue(Cancellation.CancelContract(ContractNo, 20270222D, false), 'Returns true');
        Entry.SetRange("Contract No.", ContractNo);
        Entry.FindFirst();
        Assert.AreEqual(0, Entry."Fee Amount", 'Free at 7 days');
        Ledger.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Ledger.Count(), 'One ledger entry');
        Notice.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Notice.Count(), 'One message');
        Reporting.BranchTotals('H158J', FeeTotal, Cancellations);
        Assert.AreEqual(1, Cancellations, 'Counted');
    end;

    local procedure EntryOnlyContract(VehicleNo: Code[20]; BranchCode: Code[10]): Code[20]
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
