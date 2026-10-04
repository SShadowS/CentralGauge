codeunit 85860 "HX020 Queue Pause Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SuspendedCheckoutQueuesNothing()
    var
        FacadeA: Codeunit "CGR Integration Facade";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Prepare('HX020-1');
        CreateOpenContract('HX020-C1', 'HX020-1');

        FacadeA.SuspendQueueing();
        RentalMgt.CheckOut('HX020-C1');

        Assert.AreEqual(0, EntryCount('HX020-1'), 'A checkout while queueing is suspended queues nothing');
    end;

    [Test]
    procedure SuspendedDirectQueueQueuesNothing()
    var
        FacadeA: Codeunit "CGR Integration Facade";
        FacadeB: Codeunit "CGR Integration Facade";
    begin
        Prepare('HX020-2');

        FacadeA.SuspendQueueing();
        FacadeB.QueueVehicleCheckedOut('HX020-2');

        Assert.AreEqual(0, EntryCount('HX020-2'), 'A direct QueueVehicleCheckedOut while queueing is suspended queues nothing');
    end;

    [Test]
    procedure NestedSuspendNeedsTwoResumes()
    var
        FacadeA: Codeunit "CGR Integration Facade";
    begin
        Prepare('HX020-4');

        FacadeA.SuspendQueueing();
        FacadeA.SuspendQueueing();
        FacadeA.ResumeQueueing();
        Assert.IsTrue(FacadeA.QueueingSuspended(), 'Two suspends and one resume leave queueing suspended');
        FacadeA.QueueVehicleCheckedOut('HX020-4');
        Assert.AreEqual(0, EntryCount('HX020-4'), 'Nothing is queued after only one of two resumes');

        FacadeA.ResumeQueueing();
        Assert.IsFalse(FacadeA.QueueingSuspended(), 'The second resume ends the suspension');
        FacadeA.QueueVehicleCheckedOut('HX020-4');
        Assert.AreEqual(1, EntryCount('HX020-4'), 'Queueing works again after the second resume');
    end;

    [Test]
    procedure StrayResumeIsIgnored()
    var
        FacadeA: Codeunit "CGR Integration Facade";
    begin
        Prepare('HX020-5');

        FacadeA.ResumeQueueing();
        FacadeA.SuspendQueueing();

        Assert.IsTrue(FacadeA.QueueingSuspended(), 'A resume without a suspension does not cancel the next suspend');
        FacadeA.QueueVehicleCheckedOut('HX020-5');
        Assert.AreEqual(0, EntryCount('HX020-5'), 'Nothing is queued after the suspend');
    end;

    [Test]
    procedure SuspensionSeenByEveryInstance()
    var
        FacadeA: Codeunit "CGR Integration Facade";
        FacadeB: Codeunit "CGR Integration Facade";
    begin
        Prepare('HX020-6');

        FacadeA.SuspendQueueing();
        Assert.IsTrue(FacadeB.QueueingSuspended(), 'Queueing suspended in the session is reported through another facade variable');

        FacadeB.ResumeQueueing();
        Assert.IsFalse(FacadeA.QueueingSuspended(), 'A resume through another facade variable ends the suspension');
    end;

    [Test]
    procedure SuspensionOutlivesRolledBackStep()
    var
        FacadeA: Codeunit "CGR Integration Facade";
        Ok: Boolean;
    begin
        Prepare('HX020-8');
        Commit();

        Ok := Codeunit.Run(Codeunit::"HX020 Failing Pause Run");

        Assert.IsFalse(Ok, 'The migration step fails after suspending queueing');
        Assert.IsTrue(FacadeA.QueueingSuspended(), 'Queueing stays suspended after the failed step is rolled back');
        FacadeA.QueueVehicleCheckedOut('HX020-8');
        Assert.AreEqual(0, EntryCount('HX020-8'), 'Nothing is queued after the failed step');
    end;

    // Every procedure owns its vehicle, contract, outbox rows, Setup and work date, and removes any
    // suspension left in the session (single-instance state outlives a procedure) before it starts.
    local procedure Prepare(VehicleNo: Code[20])
    var
        Setup: Record "CGR Setup";
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Entry: Record "CGR Outbox Entry";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        EndAnySuspension();

        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Insert();
    end;

    // Bounded, so a wrong QueueingSuspended cannot hang the run.
    local procedure EndAnySuspension()
    var
        Facade: Codeunit "CGR Integration Facade";
        Attempt: Integer;
    begin
        for Attempt := 1 to 10 do
            if Facade.QueueingSuspended() then
                Facade.ResumeQueueing();
    end;

    local procedure CreateOpenContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
    begin
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX020 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Status := Contract.Status::Open;
        Contract.Insert();
    end;

    local procedure EntryCount(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", VehicleNo);
        exit(Entry.Count());
    end;
}
