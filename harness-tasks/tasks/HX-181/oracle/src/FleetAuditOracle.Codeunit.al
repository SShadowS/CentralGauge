codeunit 88675 "HX181 Fleet Audit Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        FleetAudit: Codeunit "CGR Fleet Audit";
        KWindscreenEntryNo: Integer;
        MTyresEntryNo: Integer;
        MBumperEntryNo: Integer;
        MSeatEntryNo: Integer;
        MTrimEntryNo: Integer;
        NDoorEntryNo: Integer;
        NHoodEntryNo: Integer;

    [Test]
    procedure OpenDamagesBecomeFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('', 20270831D, Finding, CheckErrors);

        Assert.IsTrue(Finding.Get(MTyresEntryNo), 'The open tyre damage of HX181-M is a finding');
        Assert.AreEqual('HX181-M', Finding."Vehicle No.", 'Tyre finding: vehicle');
        Assert.AreEqual(20270720D, Finding."Reported On", 'Tyre finding: reported on');
        Assert.AreEqual('Worn tyres', Finding.Description, 'Tyre finding: description');
        Assert.AreEqual(20270831D, Finding."Audit Date", 'Tyre finding: audit date');
        Assert.IsTrue(Finding.Get(MSeatEntryNo), 'A damage reported on the audit date itself is a finding');
        Assert.IsFalse(Finding.Get(MBumperEntryNo), 'A repaired damage is no finding');
        Assert.IsFalse(Finding.Get(MTrimEntryNo), 'A damage reported after the audit date is no finding');
        Assert.IsFalse(CheckErrors.ContainsKey('HX181-M'), 'HX181-M was audited in full and is not reported as failed');
    end;

    [Test]
    procedure FailedChecksNamedWithReason()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
        Reason: Text;
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('', 20270831D, Finding, CheckErrors);

        Assert.AreEqual(2, CheckErrors.Count(), 'Exactly the two vehicles with an impossible service record could not be audited');
        Assert.IsTrue(CheckErrors.Get('HX181-K', Reason), 'HX181-K is reported as failed');
        Assert.AreEqual('Vehicle HX181-K shows a last service at 31000 km, above its mileage of 30000 km.', Reason, 'HX181-K reason');
        Assert.IsTrue(CheckErrors.Get('HX181-N', Reason), 'HX181-N is reported as failed');
        Assert.AreEqual('Vehicle HX181-N shows a last service at 25000 km, above its mileage of 22000 km.', Reason, 'HX181-N reason');
    end;

    [Test]
    procedure HalfAuditedVehicleShowsNoFinding()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('', 20270831D, Finding, CheckErrors);

        Assert.IsFalse(Finding.Get(KWindscreenEntryNo), 'HX181-K could not be audited: its windscreen damage must not be listed');
        Assert.IsFalse(Finding.Get(NDoorEntryNo), 'HX181-N could not be audited: its door damage must not be listed');
        Assert.IsFalse(Finding.Get(NHoodEntryNo), 'HX181-N could not be audited: its hood damage must not be listed');
        Finding.Reset();
        Finding.SetFilter("Vehicle No.", 'HX181-K|HX181-N');
        Assert.AreEqual(0, Finding.Count(), 'No finding of a vehicle that is in CheckErrors');
    end;

    [Test]
    procedure VehiclesBetweenFailuresKeepFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('', 20270831D, Finding, CheckErrors);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-M');
        Assert.AreEqual(2, Finding.Count(), 'HX181-M, audited between the two failed vehicles, keeps both findings');
        Finding.SetRange("Vehicle No.", 'HX181-T');
        Assert.AreEqual(0, Finding.Count(), 'HX181-T has only a repaired damage');
        Assert.IsFalse(CheckErrors.ContainsKey('HX181-T'), 'HX181-T was audited in full');
        Finding.Reset();
        Assert.AreEqual(2, Finding.Count(), 'The whole run lists the two findings of HX181-M and nothing else');
    end;

    [Test]
    procedure MileageFilterScopesTheAudit()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('<25000', 20270831D, Finding, CheckErrors);

        Assert.AreEqual(1, CheckErrors.Count(), 'Under 25000 km only HX181-N fails');
        Assert.IsTrue(CheckErrors.ContainsKey('HX181-N'), 'HX181-N (22000 km) is audited and fails');
        Assert.IsFalse(CheckErrors.ContainsKey('HX181-K'), 'HX181-K (30000 km) is outside the filter');
        Assert.IsFalse(Finding.Get(KWindscreenEntryNo), 'HX181-K is outside the filter');
        Assert.IsTrue(Finding.Get(MTyresEntryNo), 'HX181-M (18000 km) is audited');
        Finding.Reset();
        Assert.AreEqual(2, Finding.Count(), 'Only the findings of HX181-M are listed');
    end;

    [Test]
    procedure EarlierAuditDateLimitsFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
        CheckErrors: Dictionary of [Code[20], Text];
    begin
        SeedHX181Fleet();
        Commit();

        AuditHX181('', 20270815D, Finding, CheckErrors);

        Assert.IsTrue(Finding.Get(MTyresEntryNo), 'The tyre damage of 2027-07-20 is open on 2027-08-15');
        Assert.AreEqual(20270815D, Finding."Audit Date", 'The finding carries the audit date of the run');
        Assert.IsFalse(Finding.Get(MSeatEntryNo), 'The seat damage of 2027-08-31 is not reported yet on 2027-08-15');
        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-M');
        Assert.AreEqual(1, Finding.Count(), 'HX181-M has one finding on 2027-08-15');
    end;

    local procedure AuditHX181(MileageFilter: Text; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary; var CheckErrors: Dictionary of [Code[20], Text])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.SetFilter("No.", 'HX181-*');
        if MileageFilter <> '' then
            Vehicle.SetFilter(Mileage, MileageFilter);
        FleetAudit.AuditVehicles(Vehicle, AuditDate, Finding, CheckErrors);
    end;

    local procedure SeedHX181Fleet()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        WorkDate(20270831D);
        DamageEntry.SetFilter("Vehicle No.", 'HX181-*');
        DamageEntry.DeleteAll();
        Vehicle.SetFilter("No.", 'HX181-*');
        Vehicle.DeleteAll();

        AddHX181Vehicle('HX181-K', 30000, 31000);
        KWindscreenEntryNo := AddHX181Damage('HX181-K', 'Cracked windscreen', 20270803D, false);

        AddHX181Vehicle('HX181-M', 18000, 15000);
        MTyresEntryNo := AddHX181Damage('HX181-M', 'Worn tyres', 20270720D, false);
        MBumperEntryNo := AddHX181Damage('HX181-M', 'Bent bumper', 20270601D, true);
        MSeatEntryNo := AddHX181Damage('HX181-M', 'Torn seat', 20270831D, false);
        MTrimEntryNo := AddHX181Damage('HX181-M', 'Loose trim', 20270904D, false);

        AddHX181Vehicle('HX181-N', 22000, 25000);
        NDoorEntryNo := AddHX181Damage('HX181-N', 'Scratched door', 20270810D, false);
        NHoodEntryNo := AddHX181Damage('HX181-N', 'Dented hood', 20270812D, false);

        AddHX181Vehicle('HX181-T', 9000, 5000);
        AddHX181Damage('HX181-T', 'Chipped paint', 20270502D, true);
    end;

    local procedure AddHX181Vehicle(VehicleNo: Code[20]; Mileage: Integer; LastServiceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle."Last Service Km" := LastServiceKm;
        Vehicle.Insert();
    end;

    local procedure AddHX181Damage(VehicleNo: Code[20]; Description: Text[100]; ReportedOn: Date; Repaired: Boolean): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := ReportedOn;
        DamageEntry.Repaired := Repaired;
        DamageEntry.Insert();
        exit(DamageEntry."Entry No.");
    end;
}
