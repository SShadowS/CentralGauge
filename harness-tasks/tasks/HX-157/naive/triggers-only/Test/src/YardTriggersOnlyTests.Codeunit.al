codeunit 80642 "CGR Yard Triggers Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure TriggersInsertAndDeleteTally()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := TriggersVehicle('HX157-TA');
        EntryNo := TriggersFinding(VehicleNo, false);
        Assert.AreEqual(1, TriggersOpen(VehicleNo), 'Counted');

        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(0, TriggersOpen(VehicleNo), 'Removed');
    end;

    [Test]
    procedure TriggersDraftIgnored()
    var
        TempFinding: Record "CGR Yard Finding" temporary;
        VehicleNo: Code[20];
    begin
        VehicleNo := TriggersVehicle('HX157-TB');
        TriggersFinding(VehicleNo, false);

        TempFinding.Init();
        TempFinding."Entry No." := 1;
        TempFinding."Vehicle No." := VehicleNo;
        TempFinding.Insert(true);

        Assert.AreEqual(1, TriggersOpen(VehicleNo), 'Draft ignored');
    end;

    [Test]
    procedure TriggersClosedIgnored()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := TriggersVehicle('HX157-TC');
        EntryNo := TriggersFinding(VehicleNo, true);
        Assert.AreEqual(0, TriggersOpen(VehicleNo), 'Closed insert ignored');

        TriggersFinding(VehicleNo, false);
        Finding.Get(EntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, TriggersOpen(VehicleNo), 'Closed delete ignored');
    end;

    [Test]
    procedure TriggersPartnerToldOnce()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Triggers Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := TriggersVehicle('HX157-TD');
        EntryNo := TriggersFinding(VehicleNo, false);
        TriggersFinding(VehicleNo, false);
        BindSubscription(Spy);

        Finding.Get(EntryNo);
        Finding.Delete(true);
        Assert.AreEqual(0, Spy.TriggersClearCount(), 'Open findings remain');

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.FindFirst();
        Finding.Delete(true);
        Assert.AreEqual(1, Spy.TriggersClearCount(), 'Told once');
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure TriggersRefusalKeepsAll()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Triggers Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := TriggersVehicle('HX157-TE');
        EntryNo := TriggersFinding(VehicleNo, false);
        Spy.RefuseTriggersClear(VehicleNo);
        BindSubscription(Spy);
        Commit();

        Finding.Get(EntryNo);
        asserterror Finding.Delete(true);

        Assert.ExpectedError(Spy.TriggersRefusalText(VehicleNo));
        UnbindSubscription(Spy);
        Clear(Finding);
        Assert.IsTrue(Finding.Get(EntryNo), 'Finding stays');
        Assert.AreEqual(1, TriggersOpen(VehicleNo), 'Tally unchanged');
    end;

    local procedure TriggersVehicle(VehicleNo: Code[20]): Code[20]
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

    local procedure TriggersFinding(VehicleNo: Code[20]; IsClosed: Boolean): Integer
    var
        Finding: Record "CGR Yard Finding";
    begin
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding.Closed := IsClosed;
        Finding.Insert(true);
        exit(Finding."Entry No.");
    end;

    local procedure TriggersOpen(VehicleNo: Code[20]): Integer
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if Tally.Get(VehicleNo) then
            exit(Tally."Open Findings");
        exit(0);
    end;
}
