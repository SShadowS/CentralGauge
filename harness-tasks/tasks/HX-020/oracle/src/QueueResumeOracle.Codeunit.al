// Own codeunit: each SOAP call is a fresh session, so no suspension leaked by another procedure
// (single-instance state outlives a procedure within one codeunit run) can reach this row.
codeunit 85862 "HX020 Queue Resume Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ResumedCheckoutQueues()
    var
        FacadeA: Codeunit "CGR Integration Facade";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Prepare('HX020-3');
        CreateOpenContract('HX020-C3', 'HX020-3');

        FacadeA.SuspendQueueing();
        FacadeA.ResumeQueueing();
        Assert.IsFalse(FacadeA.QueueingSuspended(), 'One resume ends one suspension');
        RentalMgt.CheckOut('HX020-C3');

        Assert.AreEqual(1, EntryCount('HX020-3'), 'A checkout after the resume queues its entry');
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
