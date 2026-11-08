codeunit 80553 "CGR Desk Direct Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        DirectNotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;
        DirectLockedTxt: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.', Locked = true;

    [Test]
    procedure DirectFailedPostingRaisesItsError()
    var
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
    begin
        Attempts.Reset();
        OpenNo := DirectContract('HX148-NA1', false);
        Commit();
        asserterror DeskPosting.PostAtDesk(OpenNo);
        Assert.ExpectedError(StrSubstNo(DirectNotReturnedTxt, OpenNo));
        Assert.AreEqual(1, Attempts.Failures(), 'One failure counted');
    end;

    [Test]
    procedure DirectThreeFailuresLock()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
        GoodNo: Code[20];
        i: Integer;
    begin
        Attempts.Reset();
        OpenNo := DirectContract('HX148-NA2', false);
        GoodNo := DirectContract('HX148-NA3', true);
        for i := 1 to 3 do begin
            Commit();
            asserterror DeskPosting.PostAtDesk(OpenNo);
            Assert.ExpectedError(StrSubstNo(DirectNotReturnedTxt, OpenNo));
        end;
        Commit();
        asserterror DeskPosting.PostAtDesk(GoodNo);
        Assert.ExpectedError(DirectLockedTxt);
        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Not posted while locked');
    end;

    [Test]
    procedure DirectSuccessResetsCount()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
        GoodNo: Code[20];
        i: Integer;
    begin
        Attempts.Reset();
        OpenNo := DirectContract('HX148-NA4', false);
        GoodNo := DirectContract('HX148-NA5', true);
        for i := 1 to 2 do begin
            Commit();
            asserterror DeskPosting.PostAtDesk(OpenNo);
            Assert.ExpectedError(StrSubstNo(DirectNotReturnedTxt, OpenNo));
        end;
        Commit();
        DeskPosting.PostAtDesk(GoodNo);
        Commit();
        Assert.AreEqual(0, Attempts.Failures(), 'A successful posting resets the count');
        Contract.Get(GoodNo);
        Assert.AreEqual(Contract.Status::Posted, Contract.Status, 'Posted');
    end;

    local procedure DirectContract(VehicleNo: Code[20]; Returned: Boolean): Code[20]
    begin
        WorkDate(20270310D);
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 40);
        if Returned then
            exit(Lib.CreateReturnedContract(VehicleNo, 20270301D, 20270303D, 1100));
        exit(Lib.CreateContract(VehicleNo));
    end;
}
