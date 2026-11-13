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
        FirstEntryNo: Integer;
        FirstDone: Boolean;
        FirstPlannedOn: Date;
    begin
        InitHX173Vehicle('HX173-V5A', 20000);
        InitHX173Vehicle('HX173-V5B', 1000);
        DentEntryNo := AddHX173Damage('HX173-V5B', 'Dent', false);
        Commit();

        RunHX173(Runner, 'HX173-V5A');
        Assert.AreEqual(1, Runner.HX173Added(), 'The first vehicle adds its Service line');
        Runner.ShareHX173Proposal(Proposal);
        Proposal.FindFirst();
        FirstEntryNo := Proposal."Entry No.";
        FirstDone := Proposal.Done;
        FirstPlannedOn := Proposal."Planned On";
        RunHX173(Runner, 'HX173-V5B');

        Assert.AreEqual(1, Runner.HX173Added(), 'The second vehicle adds its Repair line');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(2, Proposal.Count(), 'Lines already in the proposal stay');
        Proposal.FindSet();
        AssertHX173Line(Proposal, 'HX173-V5A', "CGR Workshop Task Type"::Service, 0, 'Service due', 'The earlier line comes first');
        Assert.AreEqual(FirstEntryNo, Proposal."Entry No.", 'The earlier line stays as it is: Entry No.');
        Assert.AreEqual(FirstDone, Proposal.Done, 'The earlier line stays as it is: Done');
        Assert.AreEqual(FirstPlannedOn, Proposal."Planned On", 'The earlier line stays as it is: Planned On');
        Proposal.Next();
        AssertHX173Line(Proposal, 'HX173-V5B', "CGR Workshop Task Type"::Repair, DentEntryNo, 'Dent', 'The new line comes after it');
    end;

    [Test]
    procedure DueByPlanDateOnAtDate()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
    begin
        InitHX173Vehicle('HX173-V6', 1000);
        SetHX173Plan('HX173-V6', 'HX173-P6', 6, 20230901D);
        WorkDate(20240115D);
        Commit();

        RunHX173At(Runner, 'HX173-V6', 20240301D);

        Assert.AreEqual(1, Runner.HX173Added(), 'A vehicle whose plan date falls on AtDate is due for service on AtDate, although it is not due by mileage and not on the work date');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(1, Proposal.Count(), 'The proposal holds the Service line');
        Proposal.FindFirst();
        AssertHX173Line(Proposal, 'HX173-V6', "CGR Workshop Task Type"::Service, 0, 'Service due', 'Service line due by plan date');
    end;

    [Test]
    procedure NotYetDueByPlanAddsNothing()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        Runner: Codeunit "HX173 Proposal Runner";
        FirstEntryNo: Integer;
    begin
        InitHX173Vehicle('HX173-V7A', 20000);
        InitHX173Vehicle('HX173-V7', 1000);
        SetHX173Plan('HX173-V7', 'HX173-P7', 6, 20230902D);
        WorkDate(20240401D);
        Commit();

        RunHX173At(Runner, 'HX173-V7A', 20240301D);
        Runner.ShareHX173Proposal(Proposal);
        Proposal.FindFirst();
        FirstEntryNo := Proposal."Entry No.";
        RunHX173At(Runner, 'HX173-V7', 20240301D);

        Assert.AreEqual(0, Runner.HX173Added(), 'A vehicle whose plan date (2024-03-02) is after AtDate is not due on AtDate, although the work date is past it');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(1, Proposal.Count(), 'A vehicle with nothing to do adds no line and leaves the earlier line');
        Proposal.FindFirst();
        Assert.AreEqual(FirstEntryNo, Proposal."Entry No.", 'The earlier line stays as it is: Entry No.');
        AssertHX173Line(Proposal, 'HX173-V7A', "CGR Workshop Task Type"::Service, 0, 'Service due', 'The earlier line stays as it is');
    end;

    [Test]
    procedure AcceptPlansProposalInListOrder()
    var
        Proposal: Record "CGR Workshop Task" temporary;
        WorkshopTask: Record "CGR Workshop Task";
        Runner: Codeunit "HX173 Proposal Runner";
        Ok: Boolean;
        DentEntryNo: Integer;
    begin
        InitHX173Vehicle('HX173-V8A', 20000);
        InitHX173Vehicle('HX173-V8B', 1000);
        DentEntryNo := AddHX173Damage('HX173-V8B', 'Dent', false);
        Commit();

        RunHX173(Runner, 'HX173-V8A');
        RunHX173(Runner, 'HX173-V8B');
        Commit();
        Runner.SetHX173Accept();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'AcceptWorkshopProposal completes: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.HX173Added(), 'AcceptWorkshopProposal returns the number of lines it planned');
        Runner.ShareHX173Proposal(Proposal);
        Assert.AreEqual(0, Proposal.Count(), 'AcceptWorkshopProposal empties the proposal, as today');
        WorkshopTask.SetFilter("Vehicle No.", '%1|%2', 'HX173-V8A', 'HX173-V8B');
        WorkshopTask.SetCurrentKey("Entry No.");
        Assert.AreEqual(2, WorkshopTask.Count(), 'Each proposal line becomes one workshop task');
        WorkshopTask.FindSet();
        Assert.AreEqual('HX173-V8A', WorkshopTask."Vehicle No.", 'First planned task: Vehicle No.');
        Assert.AreEqual("CGR Workshop Task Type"::Service, WorkshopTask."Task Type", 'First planned task: Task Type');
        Assert.AreEqual('Service due', WorkshopTask.Description, 'First planned task: Description');
        WorkshopTask.Next();
        Assert.AreEqual('HX173-V8B', WorkshopTask."Vehicle No.", 'Second planned task: Vehicle No.');
        Assert.AreEqual("CGR Workshop Task Type"::Repair, WorkshopTask."Task Type", 'Second planned task: Task Type');
        Assert.AreEqual('Dent', WorkshopTask.Description, 'Second planned task: Description');
        Assert.AreEqual(DentEntryNo, WorkshopTask."Damage Entry No.", 'Second planned task: Damage Entry No.');
    end;

    local procedure SetHX173Plan(VehicleNo: Code[20]; PlanCode: Code[20]; IntervalMonths: Integer; LastServiceDate: Date)
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := PlanCode;
        ServicePlan.Description := 'HX173 plan';
        ServicePlan."Interval Months" := IntervalMonths;
        ServicePlan.Insert();
        Vehicle.Get(VehicleNo);
        Vehicle."Service Plan Code" := PlanCode;
        Vehicle."Last Service Date" := LastServiceDate;
        Vehicle.Modify();
    end;

    local procedure RunHX173(var Runner: Codeunit "HX173 Proposal Runner"; VehicleNo: Code[20])
    begin
        RunHX173At(Runner, VehicleNo, 20240301D);
    end;

    local procedure RunHX173At(var Runner: Codeunit "HX173 Proposal Runner"; VehicleNo: Code[20]; AtDate: Date)
    var
        Ok: Boolean;
    begin
        Commit();
        Runner.SetHX173Vehicle(VehicleNo, AtDate);
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
