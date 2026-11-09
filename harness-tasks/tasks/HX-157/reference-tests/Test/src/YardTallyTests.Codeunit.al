codeunit 80640 "CGR Yard Tally Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ScannerInsertIsCounted()
    var
        VehicleNo: Code[20];
    begin
        VehicleNo := FreshYardVehicle('HX157-A1');

        AddYardFinding(VehicleNo, false, false);

        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'A finding written without triggers is counted');
    end;

    [Test]
    procedure DeskAndScannerInsertsAddUp()
    var
        VehicleNo: Code[20];
    begin
        VehicleNo := FreshYardVehicle('HX157-B1');

        AddYardFinding(VehicleNo, false, true);
        AddYardFinding(VehicleNo, false, false);

        Assert.AreEqual(2, YardOpenCount(VehicleNo), 'Findings with and without triggers both count');
    end;

    [Test]
    procedure NightlyBulkDeleteEmptiesTheTally()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
    begin
        VehicleNo := FreshYardVehicle('HX157-C1');
        AddYardFinding(VehicleNo, false, false);
        AddYardFinding(VehicleNo, false, false);
        AddYardFinding(VehicleNo, false, false);

        Finding.SetRange("Vehicle No.", VehicleNo);
        Finding.DeleteAll(false);

        Assert.AreEqual(0, YardOpenCount(VehicleNo), 'A bulk delete without triggers empties the tally');
    end;

    [Test]
    procedure DraftDoesNotChangeTheTally()
    var
        TempFinding: Record "CGR Yard Finding" temporary;
        VehicleNo: Code[20];
    begin
        VehicleNo := FreshYardVehicle('HX157-D1');
        AddYardFinding(VehicleNo, false, true);

        TempFinding.Init();
        TempFinding."Entry No." := 1;
        TempFinding."Vehicle No." := VehicleNo;
        TempFinding.Insert(true);

        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'A draft insert leaves the tally alone');

        TempFinding.Delete(true);

        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'A draft delete leaves the tally alone');
    end;

    [Test]
    procedure ClosedFirstFindingCreatesNoTallyRow()
    var
        Tally: Record "CGR Yard Finding Tally";
        VehicleNo: Code[20];
    begin
        VehicleNo := FreshYardVehicle('HX157-E1');

        AddYardFinding(VehicleNo, true, true);

        Assert.IsFalse(Tally.Get(VehicleNo), 'A Closed first finding creates no tally row');
        Assert.AreEqual(0, YardOpenCount(VehicleNo), 'A Closed finding is not counted');
    end;

    [Test]
    procedure ClosedDeleteLeavesTallyAlone()
    var
        Finding: Record "CGR Yard Finding";
        VehicleNo: Code[20];
        ClosedEntryNo: Integer;
    begin
        VehicleNo := FreshYardVehicle('HX157-F1');
        AddYardFinding(VehicleNo, false, true);
        ClosedEntryNo := AddYardFinding(VehicleNo, true, true);

        Finding.Get(ClosedEntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'Deleting a Closed finding leaves the tally alone');
    end;

    [Test]
    procedure PartnerToldOnceOnLastOpenFinding()
    var
        Finding: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Partner Spy";
        VehicleNo: Code[20];
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        VehicleNo := FreshYardVehicle('HX157-G1');
        FirstEntryNo := AddYardFinding(VehicleNo, false, true);
        SecondEntryNo := AddYardFinding(VehicleNo, false, true);
        BindSubscription(Spy);

        Finding.Get(FirstEntryNo);
        Finding.Delete(true);

        Assert.AreEqual(0, Spy.VehicleClearCount(), 'Not told while an open finding remains');
        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'One open finding remains');

        Finding.Get(SecondEntryNo);
        Finding.Delete(true);

        Assert.AreEqual(1, Spy.VehicleClearCount(), 'Told once when the last open finding goes');
        Assert.AreEqual(0, YardOpenCount(VehicleNo), 'No open findings remain');
        UnbindSubscription(Spy);
    end;

    [Test]
    procedure PartnerRefusalKeepsFindingAndTally()
    var
        Finding: Record "CGR Yard Finding";
        StillThere: Record "CGR Yard Finding";
        Spy: Codeunit "CGR Yard Partner Spy";
        VehicleNo: Code[20];
        EntryNo: Integer;
    begin
        VehicleNo := FreshYardVehicle('HX157-H1');
        EntryNo := AddYardFinding(VehicleNo, false, true);
        Spy.RefuseVehicleClear(VehicleNo);
        BindSubscription(Spy);
        Commit();

        Finding.Get(EntryNo);
        asserterror Finding.Delete(true);

        Assert.ExpectedError(Spy.YardRefusalText(VehicleNo));
        UnbindSubscription(Spy);
        Assert.IsTrue(StillThere.Get(EntryNo), 'A refused delete keeps the finding');
        Assert.AreEqual(1, YardOpenCount(VehicleNo), 'A refused delete leaves the tally unchanged');
    end;

    local procedure FreshYardVehicle(VehicleNo: Code[20]): Code[20]
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

    local procedure AddYardFinding(VehicleNo: Code[20]; IsClosed: Boolean; WithTriggers: Boolean): Integer
    var
        Finding: Record "CGR Yard Finding";
    begin
        Finding.Init();
        Finding."Vehicle No." := VehicleNo;
        Finding.Closed := IsClosed;
        Finding.Insert(WithTriggers);
        exit(Finding."Entry No.");
    end;

    local procedure YardOpenCount(VehicleNo: Code[20]): Integer
    var
        Tally: Record "CGR Yard Finding Tally";
    begin
        if Tally.Get(VehicleNo) then
            exit(Tally."Open Findings");
        exit(0);
    end;
}
