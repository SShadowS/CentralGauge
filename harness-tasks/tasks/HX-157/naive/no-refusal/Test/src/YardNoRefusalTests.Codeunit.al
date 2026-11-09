codeunit 80648 "CGR Yard No Refusal Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure NoRefusalScannerCounted()
    var
        VehicleNo: Code[20];
    begin
        VehicleNo := NoRefusalVehicle('HX157-RA');

        NoRefusalFinding(VehicleNo, false, false);

        Assert.AreEqual(1, NoRefusalOpen(VehicleNo), 'Scanner finding counted');
    end;

    [Test]
    procedure NoRefusalBulkDeleteEmpties()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
    begin
        VehicleNo := NoRefusalVehicle('HX157-RB');
        NoRefusalFinding(VehicleNo, false, false);
        NoRefusalFinding(VehicleNo, false, false);

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.DeleteAll(false);

        Assert.AreEqual(0, NoRefusalOpen(VehicleNo), 'Bulk delete empties');
    end;

    [Test]
    procedure NoRefusalDraftIgnored()
    var
        TempFinding: Record "CGR Yard Finding" temporary;
        VehicleNo: Code[20];
    begin
        VehicleNo := NoRefusalVehicle('HX157-RC');
        NoRefusalFinding(VehicleNo, false, true);

        TempFinding.Init();
        TempFinding."Entry No." := 1;
        TempFinding."Vehicle No." := VehicleNo;
        TempFinding.Insert(true);

        Assert.AreEqual(1, NoRefusalOpen(VehicleNo), 'Draft ignored');
    end;

    [Test]
    procedure NoRefusalClosedIgnored()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := NoRefusalVehicle('HX157-RD');
        EntryNo := NoRefusalFinding(VehicleNo, true, true);
        Assert.AreEqual(0, NoRefusalOpen(VehicleNo), 'Closed insert ignored');

        NoRefusalFinding(VehicleNo, false, true);
        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, NoRefusalOpen(VehicleNo), 'Closed delete ignored');
    end;

    [Test]
    procedure NoRefusalPartnerToldOnce()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard No Refusal Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := NoRefusalVehicle('HX157-RE');
        EntryNo := NoRefusalFinding(VehicleNo, false, true);
        NoRefusalFinding(VehicleNo, false, true);
        BindSubscription(Spy);

        Finding.Get(EntryNo);
        Finding.Delete(true);
        Assert.AreEqual(0, Spy.NoRefusalClearCount(), 'Open findings remain');

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.FindFirst();
        Finding.Delete(true);
        Assert.AreEqual(1, Spy.NoRefusalClearCount(), 'Told once');
        UnbindSubscription(Spy);
    end;

    local procedure NoRefusalVehicle(VehicleNo: Code[20]): Code[20]
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

    local procedure NoRefusalFinding(VehicleNo: Code[20]; IsClosed: Boolean; WithTriggers: Boolean): Integer
    var
        Finding: Record "CGR Yard Finding";
    begin
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding.Closed := IsClosed;
        Finding.Insert(WithTriggers);
        exit(Finding."Entry No.");
    end;

    local procedure NoRefusalOpen(VehicleNo: Code[20]): Integer
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if Tally.Get(VehicleNo) then
            exit(Tally."Open Findings");
        exit(0);
    end;
}
