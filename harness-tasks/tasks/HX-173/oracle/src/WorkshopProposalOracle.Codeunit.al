codeunit 88555 "HX173 Workshop Proposal Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ServiceDueGetsServiceLine()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
    begin
        InitHX173Vehicle('HX173-V1', 20000);
        Commit();

        RunHX173(Runner, 'HX173-V1');

        Assert.AreEqual(1, Runner.HX173Added(), 'A vehicle due for service adds one line');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(1, Proposal.Count(), 'The proposal holds the Service line');
        Proposal.FindFirst();
        AssertHX173Line(Proposal, 'HX173-V1', "CGR Workshop Task Type"::Service, 0, 'Service due', 'Service line');
    end;

    [Test]
    procedure UnrepairedDamageGetsRepairLine()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
        DentEntryNo: Integer;
    begin
        InitHX173Vehicle('HX173-V2', 1000);
        AddHX173Damage('HX173-V2', 'Scratch', true);
        DentEntryNo := AddHX173Damage('HX173-V2', 'Dent', false);
        Commit();

        RunHX173(Runner, 'HX173-V2');

        Assert.AreEqual(1, Runner.HX173Added(), 'One unrepaired damage adds one line; a repaired one adds none');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(1, Proposal.Count(), 'The proposal holds one Repair line');
        Proposal.FindFirst();
        AssertHX173Line(Proposal, 'HX173-V2', "CGR Workshop Task Type"::Repair, DentEntryNo, 'Dent', 'Repair line');
    end;

    [Test]
    procedure NothingToDoAddsNothing()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
    begin
        InitHX173Vehicle('HX173-V3', 1000);
        AddHX173Damage('HX173-V3', 'Scratch', true);
        Commit();

        RunHX173(Runner, 'HX173-V3');

        Assert.AreEqual(0, Runner.HX173Added(), 'A vehicle with nothing to do returns 0');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(0, Proposal.Count(), 'A vehicle with nothing to do adds no line');
    end;

    [Test]
    procedure ServiceAndTwoDamagesThreeLines()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
        DentEntryNo: Integer;
        MirrorEntryNo: Integer;
    begin
        InitHX173Vehicle('HX173-V4', 20000);
        DentEntryNo := AddHX173Damage('HX173-V4', 'Dent', false);
        AddHX173Damage('HX173-V4', 'Scratch', true);
        MirrorEntryNo := AddHX173Damage('HX173-V4', 'Mirror', false);
        Commit();

        RunHX173(Runner, 'HX173-V4');

        Assert.AreEqual(3, Runner.HX173Added(), 'Service due and two unrepaired damages add three lines');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(3, Proposal.Count(), 'The proposal holds three lines');
        Proposal.FindSet();
        AssertHX173Line(Proposal, 'HX173-V4', "CGR Workshop Task Type"::Service, 0, 'Service due', 'First line');
        Proposal.Next();
        AssertHX173Line(Proposal, 'HX173-V4', "CGR Workshop Task Type"::Repair, DentEntryNo, 'Dent', 'Second line');
        Proposal.Next();
        AssertHX173Line(Proposal, 'HX173-V4', "CGR Workshop Task Type"::Repair, MirrorEntryNo, 'Mirror', 'Third line');
    end;

    [Test]
    procedure SecondVehicleAddsAfterFirst()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
        DentEntryNo: Integer;
    begin
        InitHX173Vehicle('HX173-V5A', 20000);
        InitHX173Vehicle('HX173-V5B', 1000);
        DentEntryNo := AddHX173Damage('HX173-V5B', 'Dent', false);
        Commit();

        RunHX173(Runner, 'HX173-V5A');
        Assert.AreEqual(1, Runner.HX173Added(), 'The first vehicle adds its Service line');
        RunHX173(Runner, 'HX173-V5B');

        Assert.AreEqual(1, Runner.HX173Added(), 'The second vehicle adds its Repair line');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(2, Proposal.Count(), 'Lines already in the proposal stay');
        Proposal.FindSet();
        AssertHX173Line(Proposal, 'HX173-V5A', "CGR Workshop Task Type"::Service, 0, 'Service due', 'The earlier line comes first');
        Proposal.Next();
        AssertHX173Line(Proposal, 'HX173-V5B', "CGR Workshop Task Type"::Repair, DentEntryNo, 'Dent', 'The new line comes after it');
    end;

    local procedure RunHX173(var Runner: Codeunit "HX173 Proposal Runner"; VehicleNo: Code[20])
    var
        Ok: Boolean;
    begin
        Commit();
        Runner.SetHX173Vehicle(VehicleNo, 20240301D);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'ProposeWorkshopTasks for ' + VehicleNo + ' completes: ' + GetLastErrorText());
    end;

    local procedure InitHX173Vehicle(VehicleNo: Code[20]; Mileage: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        WorkshopTask: Record "CGR Workshop Task";
    begin
        WorkDate(20240301D);
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        WorkshopTask.SetRange("Vehicle No.", VehicleNo);
        WorkshopTask.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Vehicle.Strategy::Default;
        Vehicle."Last Service Km" := 0;
        Vehicle.Insert();
    end;

    local procedure AddHX173Damage(VehicleNo: Code[20]; Description: Text[100]; Repaired: Boolean): Integer
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := Description;
        DamageEntry."Reported On" := 20240215D;
        DamageEntry.Repaired := Repaired;
        DamageEntry.Insert();
        exit(DamageEntry."Entry No.");
    end;

    local procedure AssertHX173Line(var Proposal: Record "CGR Workshop Task" temporary; VehicleNo: Code[20]; TaskType: Enum "CGR Workshop Task Type"; DamageEntryNo: Integer; Description: Text; Context: Text)
    begin
        Assert.AreEqual(VehicleNo, Proposal."Vehicle No.", Context + ': Vehicle No.');
        Assert.AreEqual(TaskType, Proposal."Task Type", Context + ': Task Type');
        Assert.AreEqual(DamageEntryNo, Proposal."Damage Entry No.", Context + ': Damage Entry No.');
        Assert.AreEqual(Description, Proposal.Description, Context + ': Description');
    end;
}
