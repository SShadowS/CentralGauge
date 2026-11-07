codeunit 80138 "CGR Day Closing Seed Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SeedRunningTxt: Label 'The day closing of branch %1 is already running.', Locked = true;

    [Test]
    procedure ClosingPostsDueContractsDirect()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
        LaterNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135SeedBranch('HX135N1', 20250519D, false);
        DueNo := HX135SeedContract('HX135-N11', 'HX135N1', 20250516D);
        LaterNo := HX135SeedContract('HX135-N12', 'HX135N1', 20250521D);

        DayClosing.CloseDay('HX135N1', 20250520D);

        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The due contract is posted');
        Contract.Get(LaterNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'A later contract is not posted');
        Assert.AreEqual(1, HX135SeedEntries('HX135N1', 20250520D), 'One day closing entry');
        Branch.Get('HX135N1');
        Assert.IsFalse(Branch."Day Closing Running", 'The flag is cleared');
        Assert.AreEqual(20250520D, Branch."Last Closed Date", 'Last Closed Date is set');
    end;

    [Test]
    procedure RefusedReportClearsFlagDirect()
    var
        Branch: Record "CGR Rental Branch";
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Seed Day Report Spy";
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135SeedBranch('HX135N2', 20250519D, false);
        DueNo := HX135SeedContract('HX135-N21', 'HX135N2', 20250516D);
        Spy.RefuseSeedReport('HX135N2');
        BindSubscription(Spy);

        asserterror DayClosing.CloseDay('HX135N2', 20250520D);
        Assert.ExpectedError(Spy.SeedRefusalText('HX135N2'));
        UnbindSubscription(Spy);

        Branch.Get('HX135N2');
        Assert.IsFalse(Branch."Day Closing Running", 'The flag is cleared after a failure');
        Assert.AreEqual(20250519D, Branch."Last Closed Date", 'Last Closed Date is unchanged');
        Contract.Get(DueNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Nothing is posted');
        Assert.AreEqual(0, HX135SeedEntries('HX135N2', 20250520D), 'No day closing entry');
    end;

    [Test]
    procedure SecondClosingWhileRunningChangesNothing()
    var
        DayClosing: Codeunit "CGR Day Closing";
        DueNo: Code[20];
    begin
        WorkDate(20250520D);
        HX135SeedBranch('HX135N3', 20250519D, true);
        Commit();
        DueNo := HX135SeedContract('HX135-N31', 'HX135N3', 20250516D);

        asserterror DayClosing.CloseDay('HX135N3', 20250520D);
        Assert.ExpectedError(StrSubstNo(SeedRunningTxt, 'HX135N3'));

        Assert.IsTrue(HX135SeedContractUnchanged(DueNo), 'A second closing changes nothing');
        Assert.AreEqual(0, HX135SeedEntries('HX135N3', 20250520D), 'A second closing writes no entry');
    end;

    local procedure HX135SeedBranch(BranchCode: Code[10]; LastClosedDate: Date; Running: Boolean)
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

    local procedure HX135SeedContract(VehicleNo: Code[20]; BranchCode: Code[10]; EndDate: Date): Code[20]
    begin
        Lib.SetV2Setup(0.01, BranchCode, 3);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateReturnedContract(VehicleNo, EndDate - 3, EndDate, 1100));
    end;

    local procedure HX135SeedEntries(BranchCode: Code[10]; ClosingDate: Date): Integer
    var
        ClosingEntry: Record "CGR Day Closing Entry";
    begin
        ClosingEntry.SetRange("Branch Code", BranchCode);
        ClosingEntry.SetRange("Closing Date", ClosingDate);
        exit(ClosingEntry.Count());
    end;

    local procedure HX135SeedContractUnchanged(ContractNo: Code[20]): Boolean
    var
        Contract: Record "CGR Rental Contract";
    begin
        if not Contract.Get(ContractNo) then
            exit(false);
        exit(Contract.Status = Contract.Status::Returned);
    end;
}
