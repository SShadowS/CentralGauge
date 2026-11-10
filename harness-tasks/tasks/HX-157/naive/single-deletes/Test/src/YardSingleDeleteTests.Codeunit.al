codeunit 80646 "CGR Yard Single Delete Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SingleScannerCountedDeskRemoved()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := SingleVehicle('HX157-SA');
        EntryNo := SingleFinding(VehicleNo, false, false);
        Assert.AreEqual(1, SingleOpen(VehicleNo), 'Scanner finding counted');

        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(0, SingleOpen(VehicleNo), 'Delete removes it');
    end;

    [Test]
    procedure SingleDraftIgnored()
    var
        TempFinding: Record "CGR Yard Finding" temporary;
        VehicleNo: Code[20];
    begin
        VehicleNo := SingleVehicle('HX157-SB');
        SingleFinding(VehicleNo, false, true);

        TempFinding.Init();
        TempFinding."Entry No." := 1;
        TempFinding."Vehicle No." := VehicleNo;
        TempFinding.Insert(true);

        Assert.AreEqual(1, SingleOpen(VehicleNo), 'Draft ignored');
    end;

    [Test]
    procedure SingleClosedIgnored()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := SingleVehicle('HX157-SC');
        EntryNo := SingleFinding(VehicleNo, true, true);
        Assert.AreEqual(0, SingleOpen(VehicleNo), 'Closed insert ignored');

        SingleFinding(VehicleNo, false, true);
        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, SingleOpen(VehicleNo), 'Closed delete ignored');
    end;

    [Test]
    procedure SinglePartnerToldOnce()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Single Delete Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := SingleVehicle('HX157-SD');
        EntryNo := SingleFinding(VehicleNo, false, true);
        SingleFinding(VehicleNo, false, true);
        BindSubscription(Spy);

        Finding.Get(EntryNo);
        Finding.Delete(true);
        Assert.AreEqual(0, Spy.SingleDeleteClearCount(), 'Open findings remain');

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.FindFirst();
        Finding.Delete(true);
        Assert.AreEqual(1, Spy.SingleDeleteClearCount(), 'Told once');
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure SingleRefusalKeepsAll()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Single Delete Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := SingleVehicle('HX157-SE');
        EntryNo := SingleFinding(VehicleNo, false, true);
        Spy.RefuseSingleDeleteClear(VehicleNo);
        BindSubscription(Spy);
        Commit();

        Finding.Get(EntryNo);
        asserterror Finding.Delete(true);

        Assert.ExpectedError(Spy.SingleDeleteRefusalText(VehicleNo));
        UnbindSubscription(Spy);
        Clear(Finding);
        Assert.IsTrue(Finding.Get(EntryNo), 'Finding stays');
        Assert.AreEqual(1, SingleOpen(VehicleNo), 'Tally unchanged');
    end;

    local procedure SingleVehicle(VehicleNo: Code[20]): Code[20]
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

    local procedure SingleFinding(VehicleNo: Code[20]; IsClosed: Boolean; WithTriggers: Boolean): Integer
    var
        Finding: Record "CGR Yard Finding";
    begin
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding.Closed := IsClosed;
        Finding.Insert(WithTriggers);
        exit(Finding."Entry No.");
    end;

    local procedure SingleOpen(VehicleNo: Code[20]): Integer
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if Tally.Get(VehicleNo) then
            exit(Tally."Open Findings");
        exit(0);
    end;
}
