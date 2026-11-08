codeunit 80555 "CGR Desk Spy Data Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SpyNotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;
        SpyLockedTxt: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.', Locked = true;
        SpyRefusedTxt: Label 'The payment partner refused the posting of contract %1.', Locked = true;

    [Test]
    procedure SpyDataReturnedContractPosts()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        GoodNo: Code[20];
    begin
        Attempts.Reset();
        GoodNo := SpyDataContract('HX148-NC1', true);
        SpyDataPost(GoodNo);
        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posted');
    end;

    [Test]
    procedure SpyDataSuccessRestartsCount()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        OpenNo: Code[20];
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        Attempts.Reset();
        OpenNo := SpyDataContract('HX148-NC2', false);
        FirstNo := SpyDataContract('HX148-NC3', true);
        SecondNo := SpyDataContract('HX148-NC4', true);
        SpyDataFail(OpenNo);
        SpyDataFail(OpenNo);
        SpyDataPost(FirstNo);
        SpyDataFail(OpenNo);
        SpyDataFail(OpenNo);
        SpyDataPost(SecondNo);
        Contract.Get(SecondNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posted after the restart');
    end;

    [Test]
    procedure SpyDataThreeFailuresLock()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
        GoodNo: Code[20];
    begin
        Attempts.Reset();
        OpenNo := SpyDataContract('HX148-NC5', false);
        GoodNo := SpyDataContract('HX148-NC6', true);
        SpyDataFail(OpenNo);
        SpyDataFail(OpenNo);
        SpyDataFail(OpenNo);
        Commit();
        asserterror DeskPosting.PostAtDesk(GoodNo);
        Assert.ExpectedError(SpyLockedTxt);
        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Not posted while locked');
    end;

    [Test]
    procedure SpyDataRefusalKeepsNothing()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        Spy: Codeunit "CGR Desk Spy Data Refusal";
        RefusedNo: Code[20];
    begin
        Attempts.Reset();
        RefusedNo := SpyDataContract('HX148-NC7', true);
        Spy.RefuseSpyDataPosting(RefusedNo);
        BindSubscription(Spy);
        Commit();
        asserterror DeskPosting.PostAtDesk(RefusedNo);
        Assert.ExpectedError(StrSubstNo(SpyRefusedTxt, RefusedNo));
        UnbindSubscription(Spy);
        Contract.Get(RefusedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Nothing kept');
        LedgerEntry.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'No ledger entry');
    end;

    local procedure SpyDataContract(VehicleNo: Code[20]; Returned: Boolean): Code[20]
    begin
        WorkDate(20270310D);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 40);
        if Returned then
            exit(Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, 1100));
        exit(Lib.CreateContract(VehicleNo));
    end;

    local procedure SpyDataFail(ContractNo: Code[20])
    var
        DeskPosting: Codeunit "CGR Desk Posting";
    begin
        Commit();
        asserterror DeskPosting.PostAtDesk(ContractNo);
        Assert.ExpectedError(StrSubstNo(SpyNotReturnedTxt, ContractNo));
    end;

    local procedure SpyDataPost(ContractNo: Code[20])
    var
        Runner: Codeunit "CGR Desk Spy Data Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetSpyDataContract(ContractNo);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'Posted at the desk: ' + GetLastErrorText());
        Commit();
    end;
}
