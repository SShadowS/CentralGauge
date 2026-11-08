codeunit 80554 "CGR Desk Failures Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        OnlyNotReturnedTxt: Label 'Rental contract %1 must be returned before it is posted.', Locked = true;
        OnlyLockedTxt: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.', Locked = true;

    [Test]
    procedure OnlyFailedPostingIsCounted()
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
    begin
        Attempts.Reset();
        OpenNo := OnlyOpenContract('HX148-NB1');
        Commit();
        asserterror DeskPosting.PostAtDesk(OpenNo);
        Assert.ExpectedError(StrSubstNo(OnlyNotReturnedTxt, OpenNo));
        Assert.AreEqual(1, Attempts.Failures(), 'One failure counted');
        Contract.Get(OpenNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Unchanged');
    end;

    [Test]
    procedure OnlyThirdFailureLocks()
    var
        Attempts: Codeunit "CGR Desk Attempts";
        DeskPosting: Codeunit "CGR Desk Posting";
        OpenNo: Code[20];
        i: Integer;
    begin
        Attempts.Reset();
        OpenNo := OnlyOpenContract('HX148-NB2');
        for i := 1 to 3 do begin
            Commit();
            asserterror DeskPosting.PostAtDesk(OpenNo);
            Assert.ExpectedError(StrSubstNo(OnlyNotReturnedTxt, OpenNo));
        end;
        Commit();
        asserterror DeskPosting.PostAtDesk(OpenNo);
        Assert.ExpectedError(OnlyLockedTxt);
        Assert.AreEqual(3, Attempts.Failures(), 'A refused call is not counted');
    end;

    local procedure OnlyOpenContract(VehicleNo: Code[20]): Code[20]
    begin
        WorkDate(20270310D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        exit(Lib.CreateContract(VehicleNo));
    end;
}
