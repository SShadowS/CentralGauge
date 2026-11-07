codeunit 80133 "CGR Day Closing Try Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        WrappedRunningTxt: Label 'The day closing of branch %1 is already running.', Locked = true;

    [Test]
    procedure ClosingPostsDueContractsWrapped()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
        LaterNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135WrappedBranch('HX135T1', 20250519D, false);
        DueNo := HX135WrappedContract('HX135-T11', 'HX135T1', 20250516D);
        LaterNo := HX135WrappedContract('HX135-T12', 'HX135T1', 20250521D);

        Commit();
        DayClosing.CloseDay('HX135T1', 20250520D);

        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The due contract is posted');
        Contract.Get(LaterNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A later contract is not posted');
        Assert.AreEqual(1, HX135WrappedEntries('HX135T1', 20250520D), 'One day closing entry');
        Branch.Get('HX135T1');
        Assert.IsFalse(Branch."Day Closing Running", 'The flag is cleared');
        Assert.AreEqual(20250520D, Branch."Last Closed Date", 'Last Closed Date is set');
    end;

    [Test]
    procedure RefusedReportFailsWithPartnerError()
    var
        Spy: Codeunit "CGR Try Day Report Spy";
        DayClosing: Codeunit "CGR Day Closing";
    begin
        WorkDate(20250520D);
        HX135WrappedBranch('HX135T2', 20250519D, false);
        HX135WrappedContract('HX135-T21', 'HX135T2', 20250516D);
        Spy.RefuseWrappedReport('HX135T2');
        BindSubscription(Spy);

        Commit();
        asserterror DayClosing.CloseDay('HX135T2', 20250520D);
        Assert.ExpectedError(Spy.WrappedRefusalText('HX135T2'));
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure SecondClosingRefusedWrapped()
    var
        Contract: Record "CGR Rental Contract";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135WrappedBranch('HX135T3', 20250519D, true);
        DueNo := HX135WrappedContract('HX135-T31', 'HX135T3', 20250516D);

        Commit();
        asserterror DayClosing.CloseDay('HX135T3', 20250520D);
        Assert.ExpectedError(StrSubstNo(WrappedRunningTxt, 'HX135T3'));

        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A second closing posts nothing');
    end;

    local procedure HX135WrappedBranch(BranchCode: Code[10]; LastClosedDate: Date; Running: Boolean)
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

    local procedure HX135WrappedContract(VehicleNo: Code[20]; BranchCode: Code[10]; EndDate: Date): Code[20]
    begin
        Lib.SetV2Setup(0.01, BranchCode, 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;

    local procedure HX135WrappedEntries(BranchCode: Code[10]; ClosingDate: Date): Integer
    var
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.SetRange("Closing Date", ClosingDate);
        exit(ClosingEntry.Count());
    end;
}
