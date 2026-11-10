codeunit 80644 "CGR Yard No Draft Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure NoDraftScannerCounted()
    var
        VehicleNo: Code[20];
    begin
        VehicleNo := NoDraftVehicle('HX157-NA');

        NoDraftFinding(VehicleNo, false, false);

        Assert.AreEqual(1, NoDraftOpen(VehicleNo), 'Scanner finding counted');
    end;

    [Test]
    procedure NoDraftBulkDeleteEmpties()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
    begin
        VehicleNo := NoDraftVehicle('HX157-NB');
        NoDraftFinding(VehicleNo, false, false);
        NoDraftFinding(VehicleNo, false, false);

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.DeleteAll(false);

        Assert.AreEqual(0, NoDraftOpen(VehicleNo), 'Bulk delete empties');
    end;

    [Test]
    procedure NoDraftClosedIgnored()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := NoDraftVehicle('HX157-NC');
        EntryNo := NoDraftFinding(VehicleNo, true, true);
        Assert.AreEqual(0, NoDraftOpen(VehicleNo), 'Closed insert ignored');

        NoDraftFinding(VehicleNo, false, true);
        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, NoDraftOpen(VehicleNo), 'Closed delete ignored');
    end;

    [Test]
    procedure NoDraftPartnerToldOnce()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard No Draft Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := NoDraftVehicle('HX157-ND');
        EntryNo := NoDraftFinding(VehicleNo, false, true);
        NoDraftFinding(VehicleNo, false, true);
        BindSubscription(Spy);

        Finding.Get(EntryNo);
        Finding.Delete(true);
        Assert.AreEqual(0, Spy.NoDraftClearCount(), 'Open findings remain');

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.FindFirst();
        Finding.Delete(true);
        Assert.AreEqual(1, Spy.NoDraftClearCount(), 'Told once');
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure NoDraftRefusalKeepsAll()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard No Draft Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := NoDraftVehicle('HX157-NE');
        EntryNo := NoDraftFinding(VehicleNo, false, true);
        Spy.RefuseNoDraftClear(VehicleNo);
        BindSubscription(Spy);
        Commit();

        Finding.Get(EntryNo);
        asserterror Finding.Delete(true);

        Assert.ExpectedError(Spy.NoDraftRefusalText(VehicleNo));
        UnbindSubscription(Spy);
        Clear(Finding);
        Assert.IsTrue(Finding.Get(EntryNo), 'Finding stays');
        Assert.AreEqual(1, NoDraftOpen(VehicleNo), 'Tally unchanged');
    end;

    local procedure NoDraftVehicle(VehicleNo: Code[20]): Code[20]
    var
        Finding: Record "CGR Yard Finding";
        Tally: Record "CGR Yard Finding Tally";
    begin
        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.DeleteAll(false);
        if Tally.Get(VehicleNo) then
            Tally.Delete();
        exit(VehicleNo);
    end;

    local procedure NoDraftFinding(VehicleNo: Code[20]; IsClosed: Boolean; WithTriggers: Boolean): Integer
    var
        Finding: Record "CGR Yard Finding";
    begin
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding.Closed := IsClosed;
        Finding.Insert(WithTriggers);
        exit(Finding."Entry No.");
    end;

    local procedure NoDraftOpen(VehicleNo: Code[20]): Integer
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if Tally.Get(VehicleNo) then
            exit(Tally."Open Findings");
        exit(0);
    end;
}
