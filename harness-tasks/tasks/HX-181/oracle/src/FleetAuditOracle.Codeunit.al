codeunit 88675 "HX181 Fleet Audit Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        FleetAudit: Codeunit "CGR Fleet Audit";

    [Test]
    procedure PassingVehicleListsItsFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-*', 20270531D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-A');
        Assert.AreEqual(2, Finding.Count(), 'Vehicle A: two open damages reported on or before the audit date');
        Finding.Reset();
        Assert.IsTrue(Finding.Get('HX181-A', 10000), 'Vehicle A first finding listed');
        Assert.AreEqual('Open damage reported on 2027-05-02: Cracked windscreen', Finding.Finding, 'Vehicle A first finding text');
        Assert.IsFalse(Finding."Check Failed", 'Vehicle A first finding is not a failed check');
        Assert.IsTrue(Finding.Get('HX181-A', 20000), 'Vehicle A damage reported on the audit date is listed');
        Assert.AreEqual('Open damage reported on 2027-05-31: Worn tyres', Finding.Finding, 'Vehicle A second finding text');
        Assert.IsFalse(Finding.Get('HX181-A', 0), 'Vehicle A passes its check and has no check failed line');
    end;

    [Test]
    procedure VehicleWithoutFindingsHasNoLine()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-*', 20270531D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-D');
        Assert.AreEqual(0, Finding.Count(), 'Vehicle D has a repaired damage and one reported after the audit date: no line');
    end;

    [Test]
    procedure FailedVehicleListsOnlyCheckFailedLine()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-*', 20270531D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-B');
        Finding.SetFilter("Line No.", '<>0');
        Assert.AreEqual(0, Finding.Count(), 'Vehicle B fails its check: none of the findings reported before the failure may stay');
        Finding.SetRange("Line No.");
        Assert.AreEqual(1, Finding.Count(), 'Vehicle B appears only with its check failed line');
    end;

    [Test]
    procedure FailedVehicleShowsCheckError()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-*', 20270531D, Finding);

        Finding.Reset();
        Assert.IsTrue(Finding.Get('HX181-B', 0), 'Vehicle B has its check failed line');
        Assert.IsTrue(Finding."Check Failed", 'Check Failed is set on the line');
        Assert.AreEqual('Vehicle HX181-B has an open damage without a description.', Finding.Finding, 'The line carries the check''s error text');
    end;

    [Test]
    procedure OtherVehiclesKeepFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-*', 20270531D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-A');
        Assert.AreEqual(2, Finding.Count(), 'Vehicle A, audited before the failing vehicle B, keeps its findings');
        Finding.SetRange("Vehicle No.", 'HX181-C');
        Assert.AreEqual(1, Finding.Count(), 'Vehicle C, audited after the failing vehicle B, keeps its finding');
        Finding.Reset();
        Assert.IsTrue(Finding.Get('HX181-C', 10000), 'Vehicle C finding listed');
        Assert.AreEqual('Open damage reported on 2027-05-10: Broken mirror', Finding.Finding, 'Vehicle C finding text');
        Assert.IsFalse(Finding.Get('HX181-C', 0), 'Vehicle C passes its check and has no check failed line');
    end;

    [Test]
    procedure SelectionOnlyIsAudited()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-A|HX181-C', 20270531D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-B');
        Assert.AreEqual(0, Finding.Count(), 'Vehicle B is not in the selection');
        Finding.Reset();
        Assert.AreEqual(3, Finding.Count(), 'Only the findings of vehicles A and C are listed');
        Assert.IsTrue(Finding.Get('HX181-A', 20000), 'Vehicle A in the selection is audited');
        Assert.IsTrue(Finding.Get('HX181-C', 10000), 'Vehicle C in the selection is audited');
    end;

    [Test]
    procedure AuditDateBoundsFindings()
    var
        Finding: Record "CGR Fleet Audit Finding" temporary;
    begin
        SeedHX181Fixture();
        Commit();

        RunHX181Audit('HX181-A|HX181-C', 20270515D, Finding);

        Finding.Reset();
        Finding.SetRange("Vehicle No.", 'HX181-A');
        Assert.AreEqual(1, Finding.Count(), 'Vehicle A on 2027-05-15: only the damage reported on 2027-05-02');
        Finding.Reset();
        Assert.IsTrue(Finding.Get('HX181-A', 10000), 'Vehicle A first finding listed');
        Assert.AreEqual('Open damage reported on 2027-05-02: Cracked windscreen', Finding.Finding, 'Vehicle A finding text');
        Finding.SetRange("Vehicle No.", 'HX181-C');
        Assert.AreEqual(0, Finding.Count(), 'Vehicle C damage is reported after 2027-05-15: no line');
    end;

    local procedure RunHX181Audit(VehicleFilter: Text; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.SetFilter("No.", VehicleFilter);
        FleetAudit.AuditVehicles(Vehicle, AuditDate, Finding);
    end;

    local procedure SeedHX181Fixture()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        WorkDate(20270531D);
        DamageEntry.SetFilter("Vehicle No.", 'HX181-*');
        DamageEntry.DeleteAll();
        Vehicle.SetFilter("No.", 'HX181-*');
        Vehicle.DeleteAll();

        AddHX181Vehicle('HX181-A');
        AddHX181Damage('HX181-A', 'Cracked windscreen', 20270502D, false);
        AddHX181Damage('HX181-A', 'Bent bumper', 20270410D, true);
        AddHX181Damage('HX181-A', 'Worn tyres', 20270531D, false);
        AddHX181Damage('HX181-A', 'Torn seat', 20270605D, false);

        AddHX181Vehicle('HX181-B');
        AddHX181Damage('HX181-B', 'Scratched door', 20270503D, false);
        AddHX181Damage('HX181-B', '', 20270504D, false);
        AddHX181Damage('HX181-B', 'Dented hood', 20270505D, false);

        AddHX181Vehicle('HX181-C');
        AddHX181Damage('HX181-C', 'Broken mirror', 20270510D, false);

        AddHX181Vehicle('HX181-D');
        AddHX181Damage('HX181-D', 'Chipped paint', 20270301D, true);
        AddHX181Damage('HX181-D', 'Loose trim', 20270602D, false);
    end;

    local procedure AddHX181Vehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 25000;
        Vehicle.Insert();
    end;

    local procedure AddHX181Damage(VehicleNo: Code[20]; Description: Text[100]; ReportedOn: Date; Repaired: Boolean)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := ReportedOn;
        DamageEntry.Repaired := Repaired;
        DamageEntry.Insert();
    end;
}
