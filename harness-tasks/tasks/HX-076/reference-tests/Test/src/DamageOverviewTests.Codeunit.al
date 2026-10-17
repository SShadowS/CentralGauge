codeunit 80122 "CGR Damage Overview Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PartnerEditsAndSkipsLines()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        OverviewLine: Record "CGR Damage Overview Line";
        Partner: Codeunit "CGR Overview Partner";
        DamageOverview: Codeunit "CGR Damage Overview";
        Stored: Integer;
    begin
        WorkDate(20270310D);
        HX76SeedFleet();
        OverviewLine.Init();
        OverviewLine."Vehicle No." := 'HX076-OLD';
        OverviewLine."Open Damages" := 9;
        OverviewLine.Insert();
        Assert.AreEqual(1, OverviewLine.Count(), 'The buffer holds a line of an earlier fill');
        Vehicle.Get('HX076-V');
        Assert.AreEqual(5, Vehicle."Open Damages", 'The stored counter of V disagrees with its entries');
        Partner.SetPartnerVehicles('HX076-V', 'HX076-Y');
        BindSubscription(Partner);

        Stored := DamageOverview.FillDamageOverview('HX076-*', false, OverviewLine);
        UnbindSubscription(Partner);

        Assert.AreEqual(2, Partner.PartnerCallCount(), 'The event is raised for V and Y, not for the clean C');
        Assert.AreEqual(2, Partner.SeenOpenDamages(), 'The partner sees the open damages of V');
        Assert.AreEqual(20270210D, Partner.SeenOldestDamage(), 'The partner sees the oldest open damage of V');
        Assert.IsTrue(Partner.SeenBlockedFlag(), 'The partner sees that V is blocked');
        Assert.AreEqual(1, Stored, 'Only V is stored');
        OverviewLine.Reset();
        Assert.AreEqual(1, OverviewLine.Count(), 'The buffer holds exactly the lines of this fill');
        Assert.IsFalse(OverviewLine.Get('HX076-OLD'), 'The line of the earlier fill is gone');
        Assert.IsFalse(OverviewLine.Get('HX076-Y'), 'The partner skipped Y');
        Assert.IsFalse(OverviewLine.Get('HX076-C'), 'A clean vehicle is not listed');
        Assert.IsTrue(OverviewLine.Get('HX076-V'), 'V is listed');
        Assert.AreEqual(2, OverviewLine."Open Damages", 'Two of the three entries of V are open');
        Assert.AreEqual(20270210D, OverviewLine."Oldest Open Damage", 'The repaired entry of 2027-02-01 does not count');
        Assert.IsTrue(OverviewLine.Blocked, 'Blocked is taken from V');
        Assert.AreEqual('checked', OverviewLine.Note, 'The partner''s change is stored');

        Vehicle.Get('HX076-V');
        Assert.AreEqual(5, Vehicle."Open Damages", 'The fill does not change the vehicle');
        DamageEntry.SetFilter("Vehicle No.", 'HX076-*');
        Assert.AreEqual(5, DamageEntry.Count(), 'The fill does not change the damage entries');
    end;

    [Test]
    procedure CleanVehiclesListedOnRequest()
    var
        WithClean: Record "CGR Damage Overview Line";
        WithoutClean: Record "CGR Damage Overview Line";
        DamageOverview: Codeunit "CGR Damage Overview";
    begin
        WorkDate(20270310D);
        HX76SeedFleet();

        Assert.AreEqual(2, DamageOverview.FillDamageOverview('HX076-*', false, WithoutClean), 'V and Y without the clean vehicle');
        Assert.AreEqual(2, WithoutClean.Count(), 'Two lines without clean vehicles');
        Assert.IsTrue(WithoutClean.Get('HX076-Y'), 'Y is listed when no partner skips it');
        Assert.IsFalse(WithoutClean.Get('HX076-C'), 'C is not listed');

        Assert.AreEqual(3, DamageOverview.FillDamageOverview('HX076-*', true, WithClean), 'V, Y and the clean C');
        Assert.AreEqual(3, WithClean.Count(), 'Three lines with clean vehicles');
        Assert.IsTrue(WithClean.Get('HX076-C'), 'C is listed');
        Assert.AreEqual(0, WithClean."Open Damages", 'C has only a repaired entry');
        Assert.AreEqual(0D, WithClean."Oldest Open Damage", 'C has no open damage');
        Assert.IsFalse(WithClean.Blocked, 'C is not blocked');
        Assert.IsTrue(WithClean.Get('HX076-Y'), 'Y is listed');
        Assert.AreEqual(1, WithClean."Open Damages", 'Y has one open damage');
        Assert.AreEqual(20270301D, WithClean."Oldest Open Damage", 'Y''s open damage');
        Assert.IsTrue(WithClean.Get('HX076-V'), 'V is listed');
        Assert.AreEqual(2, WithClean."Open Damages", 'V has two open damages');
        Assert.AreEqual(20270210D, WithClean."Oldest Open Damage", 'V''s oldest open damage');
        Assert.AreEqual('', WithClean.Note, 'No partner, no note');
    end;

    [Test]
    procedure FilterSelectsVehiclesByNumber()
    var
        SingleVehicle: Record "CGR Damage Overview Line";
        TwoVehicles: Record "CGR Damage Overview Line";
        DamageOverview: Codeunit "CGR Damage Overview";
    begin
        WorkDate(20270310D);
        HX76SeedFleet();

        Assert.AreEqual(1, DamageOverview.FillDamageOverview('HX076-V', true, SingleVehicle), 'One vehicle matches');
        Assert.AreEqual(1, SingleVehicle.Count(), 'One line');
        Assert.IsTrue(SingleVehicle.Get('HX076-V'), 'V is listed');

        Assert.AreEqual(2, DamageOverview.FillDamageOverview('HX076-C|HX076-Y', true, TwoVehicles), 'Two vehicles match');
        Assert.AreEqual(2, TwoVehicles.Count(), 'Two lines');
        Assert.IsTrue(TwoVehicles.Get('HX076-C'), 'C is listed');
        Assert.IsTrue(TwoVehicles.Get('HX076-Y'), 'Y is listed');
        Assert.IsFalse(TwoVehicles.Get('HX076-V'), 'V does not match the filter');
    end;

    [Test]
    procedure FillLeavesFleetUnchanged()
    var
        PartnerLines: Record "CGR Damage Overview Line";
        CleanLines: Record "CGR Damage Overview Line";
        Partner: Codeunit "CGR Overview Partner";
        DamageOverview: Codeunit "CGR Damage Overview";
        Before: Text;
    begin
        WorkDate(20270310D);
        HX76SeedFleet();
        Before := HX76FleetSnapshot();
        Assert.AreNotEqual('', Before, 'The seeded vehicles and damage entries are captured');
        Partner.SetPartnerVehicles('HX076-V', 'HX076-Y');
        BindSubscription(Partner);
        DamageOverview.FillDamageOverview('HX076-*', false, PartnerLines);
        UnbindSubscription(Partner);
        Assert.AreEqual(Before, HX76FleetSnapshot(), 'A fill with a partner that skips a line changes no vehicle and no damage entry');
        DamageOverview.FillDamageOverview('HX076-*', true, CleanLines);
        Assert.AreEqual(Before, HX76FleetSnapshot(), 'A fill with clean vehicles changes no vehicle and no damage entry');
    end;

    local procedure HX76FleetSnapshot(): Text
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        RecRef: RecordRef;
        Snapshot: Text;
    begin
        Vehicle.SetFilter("No.", 'HX076-*');
        if Vehicle.FindSet() then
            repeat
                RecRef.GetTable(Vehicle);
                Snapshot += HX76RecordText(RecRef);
            until Vehicle.Next() = 0;
        DamageEntry.SetFilter("Vehicle No.", 'HX076-*');
        if DamageEntry.FindSet() then
            repeat
                RecRef.GetTable(DamageEntry);
                Snapshot += HX76RecordText(RecRef);
            until DamageEntry.Next() = 0;
        exit(Snapshot);
    end;

    local procedure HX76RecordText(RecRef: RecordRef): Text
    var
        FldRef: FieldRef;
        RecordText: Text;
        i: Integer;
    begin
        for i := 1 to RecRef.FieldCount() do begin
            FldRef := RecRef.FieldIndex(i);
            RecordText += Format(FldRef.Value(), 0, 9) + '|';
        end;
        exit(RecordText + '/');
    end;

    local procedure HX76SeedFleet()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetFilter("Vehicle No.", 'HX076-*');
        DamageEntry.DeleteAll();
        Vehicle.SetFilter("No.", 'HX076-*');
        Vehicle.DeleteAll();
        HX76NewVehicle('HX076-V', true, 5);
        HX76NewDamage('HX076-V', 20270210D, false);
        HX76NewDamage('HX076-V', 20270201D, true);
        HX76NewDamage('HX076-V', 20270220D, false);
        HX76NewVehicle('HX076-C', false, 0);
        HX76NewDamage('HX076-C', 20270105D, true);
        HX76NewVehicle('HX076-Y', true, 1);
        HX76NewDamage('HX076-Y', 20270301D, false);
    end;

    local procedure HX76NewVehicle(VehicleNo: Code[20]; IsBlocked: Boolean; StoredOpenDamages: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Blocked := IsBlocked;
        Vehicle."Open Damages" := StoredOpenDamages;
        Vehicle.Insert();
    end;

    local procedure HX76NewDamage(VehicleNo: Code[20]; ReportedOn: Date; IsRepaired: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := 'HX076 damage';
        DamageEntry."Reported On" := ReportedOn;
        DamageEntry.Repaired := IsRepaired;
        DamageEntry.Insert();
    end;
}
