// Own codeunit: each SOAP call is a fresh session, so no suspension leaked by another procedure
// (single-instance state outlives a procedure within one codeunit run) can reach this row.
codeunit 85863 "HX020 Queue Unsuspended Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure NotSuspendedQueuesAsBefore()
    var
        Entry: Record "CGR Outbox Entry";
        FacadeA: Codeunit "CGR Integration Facade";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Prepare('HX020-7');
        CreateOpenContract('HX020-C7', 'HX020-7');

        Assert.IsFalse(FacadeA.QueueingSuspended(), 'Queueing is not suspended');
        RentalMgt.CheckOut('HX020-C7');

        Assert.AreEqual(1, EntryCount('HX020-7'), 'A checkout without a suspension queues one entry');
        Entry.SetRange("Vehicle No.", 'HX020-7');
        Entry.FindFirst();
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'Outbox event type');
        Assert.AreEqual(FacadeA.VehicleCheckedOutPayload('HX020-7'), Entry.Payload, 'Outbox payload');
    end;

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
