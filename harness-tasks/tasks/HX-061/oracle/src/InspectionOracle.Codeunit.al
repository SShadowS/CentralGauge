// Every procedure ends an inspection left by an earlier procedure before it starts and ends its own afterwards
// (single-instance state and a SingleInstance binding outlive a procedure; EndInspection runs through the runner
// and its outcome is not asserted there). Every runner call commits first. Availability and the fresh
// IsInspectionRunning are read through new local variables.
codeunit 86680 "HX061 Inspection Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure InspectionLendsBlockedVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Insp1: Codeunit "CGR Desk Inspection";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX061-1A', true, false);
        ContractNo := CreateContract('HX061-1A');
        Assert.IsFalse(Available('HX061-1A'), 'Precondition: a blocked vehicle is not available');

        Insp1.StartInspection(ListOf('HX061-1A', ''));

        Assert.IsTrue(Available('HX061-1A'), 'A listed blocked vehicle is available during the inspection');
        Assert.IsTrue(RunCheckOut(ContractNo), StrSubstNo('A listed blocked vehicle can be checked out: %1', GetLastErrorText()));
        Vehicle.Get('HX061-1A');
        Assert.IsTrue(Vehicle."Checked Out", 'The listed vehicle is checked out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Finish();
    end;

    [Test]
    procedure UnlistedVehicleAsToday()
    var
        Insp1: Codeunit "CGR Desk Inspection";
    begin
        Prepare();
        CreateVehicle('HX061-2A', true, false);
        CreateVehicle('HX061-2B', true, false);
        CreateVehicle('HX061-2F', false, false);

        Insp1.StartInspection(ListOf('HX061-2A', ''));

        Assert.IsTrue(Available('HX061-2A'), 'Precondition: the listed blocked vehicle is lent');
        Assert.IsFalse(Available('HX061-2B'), 'An unlisted blocked vehicle stays unavailable');
        Assert.IsTrue(Available('HX061-2F'), 'An unlisted free vehicle stays available');
        Finish();
    end;

    [Test]
    procedure EndStopsLending()
    var
        Insp1: Codeunit "CGR Desk Inspection";
    begin
        Prepare();
        CreateVehicle('HX061-3A', true, false);
        Insp1.StartInspection(ListOf('HX061-3A', ''));
        Assert.IsTrue(Available('HX061-3A'), 'Precondition: the listed blocked vehicle is lent');

        Insp1.EndInspection();

        Assert.IsFalse(Available('HX061-3A'), 'After the inspection ends the blocked vehicle is unavailable again');
        Assert.IsFalse(Insp1.IsInspectionRunning(), 'No inspection runs after EndInspection');
        Assert.IsFalse(Running(), 'No inspection runs after EndInspection (fresh variable)');
        Finish();
    end;

    [Test]
    procedure EndThroughOtherVariable()
    var
        Insp1: Codeunit "CGR Desk Inspection";
        Insp2: Codeunit "CGR Desk Inspection";
    begin
        Prepare();
        CreateVehicle('HX061-4A', true, false);
        Insp1.StartInspection(ListOf('HX061-4A', ''));
        Assert.IsTrue(Available('HX061-4A'), 'Precondition: the listed blocked vehicle is lent');

        Insp2.EndInspection();

        Assert.IsFalse(Available('HX061-4A'), 'An inspection ended through another variable stops lending');
        Assert.IsFalse(Insp1.IsInspectionRunning(), 'The starting variable sees that the inspection ended');
        Finish();
    end;

    [Test]
    procedure RestartReplacesList()
    var
        Insp1: Codeunit "CGR Desk Inspection";
    begin
        Prepare();
        CreateVehicle('HX061-5A', true, false);
        CreateVehicle('HX061-5B', true, false);
        Insp1.StartInspection(ListOf('HX061-5A', ''));
        Assert.IsTrue(Available('HX061-5A'), 'Precondition: the first list is lent');
        Assert.IsFalse(Available('HX061-5B'), 'Precondition: a vehicle outside the first list is not lent');

        Assert.IsTrue(RunStart(ListOf('HX061-5B', '')), StrSubstNo('Starting again while an inspection runs succeeds: %1', GetLastErrorText()));

        Assert.IsFalse(Available('HX061-5A'), 'A vehicle only on the replaced list is no longer lent');
        Assert.IsTrue(Available('HX061-5B'), 'A vehicle on the new list is lent');
        Finish();
    end;

    [Test]
    procedure EndWithoutInspection()
    begin
        Prepare();

        Assert.IsTrue(RunEnd(), StrSubstNo('Ending when no inspection runs raises no error: %1', GetLastErrorText()));

        Assert.IsFalse(Running(), 'No inspection runs');
        Finish();
    end;

    [Test]
    procedure ListedCheckedOutNotAvailable()
    var
        Insp1: Codeunit "CGR Desk Inspection";
        VehicleNos: List of [Code[20]];
    begin
        Prepare();
        CreateVehicle('HX061-7A', true, false);
        CreateVehicle('HX061-7C', false, true);
        DeleteVehicle('HX061-7X');
        VehicleNos.Add('HX061-7A');
        VehicleNos.Add('HX061-7C');
        VehicleNos.Add('HX061-7X');

        Insp1.StartInspection(VehicleNos);

        Assert.IsTrue(Available('HX061-7A'), 'Precondition: the listed blocked vehicle is lent');
        Assert.IsFalse(Available('HX061-7C'), 'A listed vehicle that is checked out is not available');
        Assert.IsFalse(Available('HX061-7X'), 'A listed number that is no vehicle is not available');
        Finish();
    end;

    [Test]
    procedure CheckOutForInspectionAsToday()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX061-8D', true, false);
        ContractNo := CreateContract('HX061-8D');
        Assert.IsFalse(Available('HX061-8D'), 'Precondition: the blocked vehicle is not available');

        Assert.IsTrue(RunCheckOutForInspection(ContractNo), StrSubstNo('CheckOutForInspection checks out a blocked vehicle: %1', GetLastErrorText()));

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Vehicle.Get('HX061-8D');
        Assert.IsTrue(Vehicle."Checked Out", 'The vehicle is checked out');
        Finish();
    end;

    [Test]
    procedure CheckOutForInspectionEnds()
    var
        ContractNo: Code[20];
    begin
        Prepare();
        CreateVehicle('HX061-9G', true, false);
        CreateVehicle('HX061-9E', true, false);
        ContractNo := CreateContract('HX061-9G');

        Assert.IsTrue(RunCheckOutForInspection(ContractNo), StrSubstNo('CheckOutForInspection succeeds: %1', GetLastErrorText()));

        Assert.IsFalse(Running(), 'No inspection runs after CheckOutForInspection');
        Assert.IsFalse(Available('HX061-9E'), 'A blocked vehicle is not available after CheckOutForInspection');
        Finish();
    end;

    [Test]
    procedure RunningFlag()
    var
        Insp1: Codeunit "CGR Desk Inspection";
    begin
        Prepare();
        CreateVehicle('HX061-10A', true, false);

        Insp1.StartInspection(ListOf('HX061-10A', ''));

        Assert.IsTrue(Running(), 'An inspection runs after StartInspection (fresh variable)');
        Assert.IsTrue(Insp1.IsInspectionRunning(), 'An inspection runs after StartInspection');
        Finish();
    end;

    local procedure Available(VehicleNo: Code[20]): Boolean
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        exit(FleetMgt.IsAvailable(VehicleNo));
    end;

    local procedure Running(): Boolean
    var
        DeskInspection: Codeunit "CGR Desk Inspection";
    begin
        exit(DeskInspection.IsInspectionRunning());
    end;

    local procedure ListOf(VehicleNo1: Code[20]; VehicleNo2: Code[20]) VehicleNos: List of [Code[20]]
    begin
        if VehicleNo1 <> '' then
            VehicleNos.Add(VehicleNo1);
        if VehicleNo2 <> '' then
            VehicleNos.Add(VehicleNo2);
    end;

    local procedure RunEnd(): Boolean
    var
        Runner: Codeunit "HX061 Desk Runner";
    begin
        Commit();
        Runner.SetEnd();
        exit(Runner.Run());
    end;

    local procedure RunStart(VehicleNos: List of [Code[20]]): Boolean
    var
        Runner: Codeunit "HX061 Desk Runner";
    begin
        Commit();
        Runner.SetStart(VehicleNos);
        exit(Runner.Run());
    end;

    local procedure RunCheckOut(ContractNo: Code[20]): Boolean
    var
        Runner: Codeunit "HX061 Desk Runner";
    begin
        Commit();
        Runner.SetCheckOut(ContractNo);
        exit(Runner.Run());
    end;

    local procedure RunCheckOutForInspection(ContractNo: Code[20]): Boolean
    var
        Runner: Codeunit "HX061 Desk Runner";
    begin
        Commit();
        Runner.SetCheckOutForInspection(ContractNo);
        exit(Runner.Run());
    end;

    local procedure CreateContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'HX061 Customer', 20270301D, 20270303D));
    end;

    local procedure DeleteVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        OutboxEntry: Record "CGR Outbox Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        OutboxEntry.SetRange("Vehicle No.", VehicleNo);
        OutboxEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
    end;

    local procedure CreateVehicle(VehicleNo: Code[20]; IsBlocked: Boolean; IsCheckedOut: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        DeleteVehicle(VehicleNo);
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        Vehicle.Insert();
        if IsBlocked then begin
            Vehicle.Blocked := true;
            Vehicle."Open Damages" := 1;
        end;
        Vehicle."Checked Out" := IsCheckedOut;
        Vehicle.Modify();
    end;

    local procedure Finish()
    begin
        if RunEnd() then;
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        if RunEnd() then;
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Weekend Surcharge %" := 0;
        Setup."Km Allowance per Day" := 1000;
        Setup."Excess Km Rate" := 0;
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;
}
