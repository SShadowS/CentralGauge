codeunit 80131 "CGR Day Closing Spy Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        LocalRunningTxt: Label 'The day closing of branch %1 is already running.', Locked = true;

    [Test]
    procedure ClosingPostsDueContractsLocalSpy()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        ReportSpy: Codeunit "CGR Local Day Report Spy";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
        LaterNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135LocalBranch('HX135L1', 20250519D, false);
        DueNo := HX135LocalContract('HX135-L11', 'HX135L1', 20250516D);
        LaterNo := HX135LocalContract('HX135-L12', 'HX135L1', 20250521D);
        BindSubscription(ReportSpy);

        Commit();
        DayClosing.CloseDay('HX135L1', 20250520D);
        UnbindSubscription(ReportSpy);

        Assert.AreEqual(1, ReportSpy.LocalReportsSent(), 'The day report is sent once');
        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The due contract is posted');
        Contract.Get(LaterNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A later contract is not posted');
        Assert.AreEqual(1, HX135LocalEntries('HX135L1', 20250520D), 'One day closing entry');
        Branch.Get('HX135L1');
        Assert.IsFalse(Branch."Day Closing Running", 'The flag is cleared');
        Assert.AreEqual(20250520D, Branch."Last Closed Date", 'Last Closed Date is set');
    end;

    [Test]
    procedure RefusedReportIsSentOnceAndClearsFlag()
    var
        Branch: Record "CGR Rental Branch";
        ReportSpy: Codeunit "CGR Local Day Report Spy";
        DayClosing: Codeunit "CGR Day Closing";
    begin
        WorkDate(20250520D);
        HX135LocalBranch('HX135L2', 20250519D, false);
        HX135LocalContract('HX135-L21', 'HX135L2', 20250516D);
        ReportSpy.SetLocalRefusal('HX135L2');
        BindSubscription(ReportSpy);

        Commit();
        asserterror DayClosing.CloseDay('HX135L2', 20250520D);
        Assert.ExpectedError(ReportSpy.LocalRefusalText('HX135L2'));
        UnbindSubscription(ReportSpy);

        Assert.AreEqual(1, ReportSpy.LocalReportsSent(), 'The day report is attempted once');
        Branch.Get('HX135L2');
        Assert.IsFalse(Branch."Day Closing Running", 'The flag is cleared after a failure');
    end;

    [Test]
    procedure SecondClosingRefusedLocalSpy()
    var
        Contract: Record "CGR Rental Contract";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135LocalBranch('HX135L3', 20250519D, true);
        DueNo := HX135LocalContract('HX135-L31', 'HX135L3', 20250516D);

        Commit();
        asserterror DayClosing.CloseDay('HX135L3', 20250520D);
        Assert.ExpectedError(StrSubstNo(LocalRunningTxt, 'HX135L3'));

        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A second closing posts nothing');
    end;

    local procedure HX135LocalBranch(BranchCode: Code[10]; LastClosedDate: Date; Running: Boolean)
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        Contract.SetRange("Branch Code", BranchCode);
        Contract.DeleteAll();
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.DeleteAll();
        if Branch.Get(BranchCode) then
            Branch.Delete();
        Branch.Init();
        Branch.Code := BranchCode;
        Branch."Day Closing Running" := Running;
        Branch."Last Closed Date" := LastClosedDate;
        Branch.Insert();
    end;

    local procedure HX135LocalContract(VehicleNo: Code[20]; BranchCode: Code[10]; EndDate: Date): Code[20]
    begin
        Lib.SetV2Setup(0.01, BranchCode, 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;

    local procedure HX135LocalEntries(BranchCode: Code[10]; ClosingDate: Date): Integer
    var
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.SetRange("Closing Date", ClosingDate);
        exit(ClosingEntry.Count());
    end;
}
