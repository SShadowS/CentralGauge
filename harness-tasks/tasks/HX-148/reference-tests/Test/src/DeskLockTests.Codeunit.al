codeunit 80550 "CGR Desk Lock Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;
        DeskLockedTxt: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.', Locked = true;
        PartnerRefusedTxt: Label 'The payment partner refused the posting of contract %1.', Locked = true;

    [Test]
    procedure FailedPostingFailsWithThePostingError()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
    begin
        HX148Prepare();
        OpenNo := HX148OpenContract('HX148-A1');

        Commit();
        asserterror DeskPosting.PostAtDesk(OpenNo);

        Assert.ExpectedError(StrSubstNo(NotReturnedTxt, OpenNo));
        Assert.AreEqual(1, Attempts.Failures(), 'A failed posting counts once');
        Contract.Get(OpenNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract that failed to post is unchanged');
    end;

    [Test]
    procedure ThreeFailedPostingsLockTheDesk()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
        ReturnedNo: Code[20];
        i: Integer;
    begin
        HX148Prepare();
        OpenNo := HX148OpenContract('HX148-B1');
        ReturnedNo := HX148ReturnedContract('HX148-B2');
        for i := 1 to 3 do
            HX148FailAtDesk(OpenNo);

        Commit();
        asserterror DeskPosting.PostAtDesk(ReturnedNo);

        Assert.ExpectedError(DeskLockedTxt);
        Assert.AreEqual(3, Attempts.Failures(), 'A refused call does not count as a failed posting');
        Contract.Get(ReturnedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The locked desk does not post');
        LedgerEntry.SetRange("Contract No.", ReturnedNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'The locked desk writes no ledger entry');
    end;

    [Test]
    procedure SuccessfulPostingRestartsTheCount()
    var
        Contract: Record "CGR Rental Contract";
        OpenNo: Code[20];
        FirstNo: Code[20];
        SecondNo: Code[20];
    begin
        HX148Prepare();
        OpenNo := HX148OpenContract('HX148-C1');
        FirstNo := HX148ReturnedContract('HX148-C2');
        SecondNo := HX148ReturnedContract('HX148-C3');
        HX148FailAtDesk(OpenNo);
        HX148FailAtDesk(OpenNo);
        HX148PostThroughRunner(FirstNo);

        HX148FailAtDesk(OpenNo);
        HX148FailAtDesk(OpenNo);
        HX148PostThroughRunner(SecondNo);

        Contract.Get(SecondNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Two failures after a successful posting do not lock');
    end;

    [Test]
    procedure ReturnedContractPostsAtTheDesk()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Attempts: Codeunit "CGR Desk Attempts";
        ReturnedNo: Code[20];
    begin
        HX148Prepare();
        ReturnedNo := HX148ReturnedContract('HX148-D1');

        HX148PostThroughRunner(ReturnedNo);

        Contract.Get(ReturnedNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'The returned contract is posted');
        LedgerEntry.SetRange("Contract No.", ReturnedNo);
        Assert.AreEqual(1, LedgerEntry.Count(), 'The posting writes one ledger entry');
        Assert.AreEqual(0, Attempts.Failures(), 'A successful posting leaves no failure');
    end;

    [Test]
    procedure PartnerRefusalIsAFailedPosting()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        Spy: Codeunit "CGR Desk Refusal Spy";
        RefusedNo: Code[20];
    begin
        HX148Prepare();
        RefusedNo := HX148ReturnedContract('HX148-E1');
        Spy.RefuseDeskPosting(RefusedNo);
        BindSubscription(Spy);

        Commit();
        asserterror DeskPosting.PostAtDesk(RefusedNo);

        Assert.ExpectedError(StrSubstNo(PartnerRefusedTxt, RefusedNo));
        UnbindSubscription(Spy);
        Assert.AreEqual(1, Attempts.Failures(), 'A posting that fails inside CGR Rental-Post is a failed posting');
        Contract.Get(RefusedNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Nothing of the refused posting is kept');
        LedgerEntry.SetRange("Contract No.", RefusedNo);
        Assert.AreEqual(0, LedgerEntry.Count(), 'The refused posting leaves no ledger entry');
    end;

    local procedure HX148Prepare()
    var
        Attempts: Codeunit "CGR Desk Attempts";
    begin
        Attempts.Reset();
        WorkDate(20270310D);
        Lib.SetPricing(0, 1000, 0);
    end;

    local procedure HX148OpenContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 40);
        exit(Lib.CreateContract(VehicleNo));
    end;

    local procedure HX148ReturnedContract(VehicleNo: Code[20]): Code[20]
    begin
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 40);
        exit(Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, 1100));
    end;

    local procedure HX148FailAtDesk(ContractNo: Code[20])
    var
        DeskPosting: Codeunit "CGR Desk Posting";
    begin
        Commit();
        asserterror DeskPosting.PostAtDesk(ContractNo);
        Assert.ExpectedError(StrSubstNo(NotReturnedTxt, ContractNo));
    end;

    local procedure HX148PostThroughRunner(ContractNo: Code[20])
    var
        Runner: Codeunit "CGR Desk Lock Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetDeskContract(ContractNo);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The desk posts returned contract ' + ContractNo + ': ' + GetLastErrorText());
        Commit();
    end;
}
