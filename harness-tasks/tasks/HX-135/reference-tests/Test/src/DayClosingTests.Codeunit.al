codeunit 80135 "CGR Day Closing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        AlreadyRunningTxt: Label 'The day closing of branch %1 is already running.', Locked = true;

    [Test]
    procedure SuccessfulClosingPostsDueContractsAndClearsFlag()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Day Report Spy";
        Runner: Codeunit "CGR Day Closing Test Runner";
        BeforeNo: Code[20];
        OnDayNo: Code[20];
        LaterNo: Code[20];
        OtherBranchNo: Code[20];
        Ok: Boolean;
    begin
        WorkDate(20250520D);
        HX135NewBranch('HX135S1', 20250519D, false);
        HX135NewBranch('HX135S2', 20250519D, false);
        BeforeNo := HX135ReturnedContract('HX135-S11', 'HX135S1', 20250516D);
        OnDayNo := HX135ReturnedContract('HX135-S12', 'HX135S1', 20250520D);
        LaterNo := HX135ReturnedContract('HX135-S13', 'HX135S1', 20250521D);
        OtherBranchNo := HX135ReturnedContract('HX135-S21', 'HX135S2', 20250516D);
        BindSubscription(Spy);
        Runner.SetDayClosingRun('HX135S1', 20250520D);

        Commit();
        Ok := Runner.Run();
        UnbindSubscription(Spy);

        Assert.IsTrue(Ok, 'A day closing nobody refuses succeeds: ' + GetLastErrorText());
        Contract.Get(BeforeNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'A returned contract that ended before the closing date is posted');
        Contract.Get(OnDayNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'A returned contract that ended on the closing date is posted');
        Contract.Get(LaterNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A contract that ends after the closing date is not posted');
        Contract.Get(OtherBranchNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A contract of another branch is not posted');
        Assert.AreEqual(1, HX135CashCounts('HX135S1', 20250520D), 'One cash count for the branch and date');
        Assert.AreEqual(1, HX135ClosingEntries('HX135S1', 20250520D), 'One day closing entry for the branch and date');
        Assert.AreEqual(1, Spy.DayReportsSent(), 'OnAfterDayClosed is raised once');
        Assert.IsTrue(Spy.RunningFlagStoredDuringReport(), 'Day Closing Running is stored while the closing runs');
        Branch.Get('HX135S1');
        Assert.IsFalse(Branch."Day Closing Running", 'Day Closing Running is cleared after a successful closing');
        Assert.AreEqual(20250520D, Branch."Last Closed Date", 'Last Closed Date is the closing date');
    end;

    [Test]
    procedure RefusedDayReportKeepsNothingAndClearsFlag()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Day Report Spy";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135NewBranch('HX135F1', 20250519D, false);
        DueNo := HX135ReturnedContract('HX135-F11', 'HX135F1', 20250516D);
        Spy.RefuseDayReport('HX135F1');
        BindSubscription(Spy);

        Commit();
        asserterror DayClosing.CloseDay('HX135F1', 20250520D);
        Assert.ExpectedError(Spy.DayReportRefusalText('HX135F1'));
        UnbindSubscription(Spy);

        Branch.Get('HX135F1');
        Assert.IsFalse(Branch."Day Closing Running", 'Day Closing Running is cleared after a failed closing');
        Assert.AreEqual(20250519D, Branch."Last Closed Date", 'A failed closing leaves Last Closed Date unchanged');
        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A failed closing posts no contract');
        Assert.AreEqual(0, HX135LedgerEntries(DueNo), 'A failed closing leaves no ledger entry');
        Assert.AreEqual(0, HX135CashCounts('HX135F1', 20250520D), 'A failed closing leaves no cash count');
        Assert.AreEqual(0, HX135ClosingEntries('HX135F1', 20250520D), 'A failed closing leaves no day closing entry');
    end;

    [Test]
    procedure RefusedDayReportThroughRunnerLeavesFlagClearedAndSaved()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Day Report Spy";
        Runner: Codeunit "CGR Day Closing Test Runner";
        DueNo: Code[20];
        ErrorText: Text;
        Ok: Boolean;
    begin
        WorkDate(20250520D);
        HX135NewBranch('HX135F2', 20250519D, false);
        DueNo := HX135ReturnedContract('HX135-F21', 'HX135F2', 20250516D);
        Spy.RefuseDayReport('HX135F2');
        BindSubscription(Spy);
        Runner.SetDayClosingRun('HX135F2', 20250520D);

        Commit();
        ClearLastError();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();
        UnbindSubscription(Spy);

        Assert.IsFalse(Ok, 'A refused day report makes the closing fail');
        Assert.AreEqual(Spy.DayReportRefusalText('HX135F2'), ErrorText, 'The closing fails with the error that made it fail');
        Branch.Get('HX135F2');
        Assert.IsFalse(Branch."Day Closing Running", 'The cleared flag is saved although the closing failed');
        Assert.AreEqual(20250519D, Branch."Last Closed Date", 'A failed closing leaves Last Closed Date unchanged');
        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A failed closing posts no contract');
        Assert.AreEqual(0, HX135LedgerEntries(DueNo), 'A failed closing leaves no ledger entry');
        Assert.AreEqual(0, HX135CashCounts('HX135F2', 20250520D), 'A failed closing leaves no cash count');
        Assert.AreEqual(0, HX135ClosingEntries('HX135F2', 20250520D), 'A failed closing leaves no day closing entry');
    end;

    [Test]
    procedure SecondClosingWhileRunningIsRefused()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135NewBranch('HX135R1', 20250519D, true);
        DueNo := HX135ReturnedContract('HX135-R11', 'HX135R1', 20250516D);

        Commit();
        asserterror DayClosing.CloseDay('HX135R1', 20250520D);
        Assert.ExpectedError(StrSubstNo(AlreadyRunningTxt, 'HX135R1'));

        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A second closing posts nothing');
        Assert.AreEqual(0, HX135ClosingEntries('HX135R1', 20250520D), 'A second closing writes no day closing entry');
        Branch.Get('HX135R1');
        Assert.AreEqual(20250519D, Branch."Last Closed Date", 'A second closing leaves Last Closed Date unchanged');
    end;

    local procedure HX135NewBranch(BranchCode: Code[10]; LastClosedDate: Date; Running: Boolean)
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        CashCount: Record "CGR Cash Count";
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        Contract.SetRange("Branch Code", BranchCode);
        Contract.DeleteAll();
        CashCount.SetRange("Branch Code", BranchCode);
        CashCount.DeleteAll();
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.DeleteAll();
        if Branch.Get(BranchCode) then
            Branch.Delete();
        Branch.Init();
        Branch.Code := BranchCode;
        Branch.Name := 'HX135 branch';
        Branch."Day Closing Running" := Running;
        Branch."Last Closed Date" := LastClosedDate;
        Branch.Insert();
    end;

    local procedure HX135ReturnedContract(VehicleNo: Code[20]; BranchCode: Code[10]; EndDate: Date): Code[20]
    begin
        Lib.SetV2Setup(0.01, BranchCode, 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.ClearLedgerEntries(VehicleNo);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;

    local procedure HX135CashCounts(BranchCode: Code[10]; ClosingDate: Date): Integer
    var
        CashCount: Record "CGR Cash Count";
    begin
        CashCount.SetRange("Branch Code", BranchCode);
        CashCount.SetRange("Closing Date", ClosingDate);
        exit(CashCount.Count());
    end;

    local procedure HX135ClosingEntries(BranchCode: Code[10]; ClosingDate: Date): Integer
    var
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.SetRange("Closing Date", ClosingDate);
        exit(ClosingEntry.Count());
    end;

    local procedure HX135LedgerEntries(ContractNo: Code[20]): Integer
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        exit(LedgerEntry.Count());
    end;
}
