codeunit 85900 "HX022 Vehicle Renumber Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure RentalRecordsFollow()
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNo: Integer;
    begin
        InitRun();
        ClearVehicle('HX022-1N');
        NewVehicle('HX022-1O');
        InsertRentalContract('HX022-1C', 'HX022-1O');
        EntryNo := InsertLedgerEntry('HX022-1C', 'HX022-1O');

        FleetMgt.ChangeVehicleNo('HX022-1O', 'HX022-1N');

        Contract.Get('HX022-1C');
        Assert.AreEqual('HX022-1N', Contract."Vehicle No.", 'The rental contract carries the new number');
        LedgerEntry.Get(EntryNo);
        Assert.AreEqual('HX022-1N', LedgerEntry."Vehicle No.", 'The rental ledger entry carries the new number');
        LedgerEntry.Reset();
        LedgerEntry.SetRange("Vehicle No.", 'HX022-1N');
        Assert.AreEqual(1, LedgerEntry.Count(), 'The ledger entry is found under the new number');
    end;

    [Test]
    procedure DamageEntriesFollow()
    var
        DamageEntry: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        InitRun();
        ClearVehicle('HX022-2N');
        NewVehicle('HX022-2O');
        EntryNo := DamageMgt.RegisterDamage('HX022-2O', 'HX022 dented door');

        FleetMgt.ChangeVehicleNo('HX022-2O', 'HX022-2N');

        DamageEntry.Get(EntryNo);
        Assert.AreEqual('HX022-2N', DamageEntry."Vehicle No.", 'The damage entry carries the new number');
        Vehicle.Get('HX022-2N');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle stays blocked by its open damage');
        Assert.AreEqual(1, Vehicle."Open Damages", 'The vehicle keeps its open damage count');

        DamageMgt.RepairDamage(EntryNo);
        Vehicle.Get('HX022-2N');
        Assert.IsFalse(Vehicle.Blocked, 'Repairing the moved damage releases the vehicle under its new number');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage is left after the repair');
    end;

    [Test]
    procedure LeaseContractsFollow()
    var
        LeaseContract: Record "CGR Lease Contract";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        InitRun();
        ClearVehicle('HX022-3N');
        NewVehicle('HX022-3O');
        InsertLease('HX022-3L', 'HX022-3O');

        FleetMgt.ChangeVehicleNo('HX022-3O', 'HX022-3N');

        LeaseContract.Get('HX022-3L');
        Assert.AreEqual('HX022-3N', LeaseContract."Vehicle No.", 'The lease contract carries the new number');
    end;

    [Test]
    procedure LeaseInvoiceLinesFollow()
    var
        LeaseContract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        InitRun();
        ClearVehicle('HX022-4N');
        NewVehicle('HX022-4O');
        InsertInvoicedLease('HX022-4L', 'HX022-4O');

        FleetMgt.ChangeVehicleNo('HX022-4O', 'HX022-4N');

        InvoiceLine.Get('HX022-4L', 10000);
        Assert.AreEqual('HX022-4N', InvoiceLine."Vehicle No.", 'The lease invoice line carries the new number');
        LeaseContract.Get('HX022-4L');
        Assert.AreEqual('HX022-4N', LeaseContract."Vehicle No.", 'The invoiced lease carries the new number');
    end;

    [Test]
    procedure OutboxEntriesFollowPayloadKept()
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        SentEntryNo: Integer;
        PendingEntryNo: Integer;
        OldPayload: Text;
    begin
        InitRun();
        ClearVehicle('HX022-5N');
        NewVehicle('HX022-5O');
        SentEntryNo := QueueOutbox('HX022-5O');
        PendingEntryNo := QueueOutbox('HX022-5O');
        Facade.MarkSent(SentEntryNo);
        OldPayload := Facade.VehicleCheckedOutPayload('HX022-5O');

        FleetMgt.ChangeVehicleNo('HX022-5O', 'HX022-5N');

        Entry.Get(SentEntryNo);
        Assert.AreEqual('HX022-5N', Entry."Vehicle No.", 'The sent outbox entry carries the new number');
        Assert.IsTrue(Entry.Sent, 'The sent outbox entry stays sent');
        Assert.AreEqual(OldPayload, Entry.Payload, 'The payload of the sent entry is not rewritten');
        Entry.Get(PendingEntryNo);
        Assert.AreEqual('HX022-5N', Entry."Vehicle No.", 'The pending outbox entry carries the new number');
        Assert.IsFalse(Entry.Sent, 'The pending outbox entry stays pending');
        Assert.AreEqual(OldPayload, Entry.Payload, 'The payload of the pending entry is not rewritten');
    end;

    [Test]
    procedure VehicleKeepsItsData()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        InitRun();
        ClearVehicle('HX022-6N');
        NewVehicle('HX022-6O');
        if not ServicePlan.Get('HX022-P6') then begin
            ServicePlan.Init();
            ServicePlan.Code := 'HX022-P6';
            ServicePlan.Description := 'HX022 plan';
            ServicePlan."Interval Months" := 6;
            ServicePlan.Insert();
        end;
        Vehicle.Get('HX022-6O');
        Vehicle.Mileage := 45210;
        Vehicle.Strategy := Vehicle.Strategy::"Heavy Duty";
        Vehicle."Service Plan Code" := 'HX022-P6';
        Vehicle."Last Service Km" := 40000;
        Vehicle."Last Service Date" := 20270115D;
        Vehicle."Daily Rate" := 55.5;
        Vehicle.Description := 'HX022 box van';
        Vehicle.Modify();

        FleetMgt.ChangeVehicleNo('HX022-6O', 'HX022-6N');

        Assert.IsFalse(Vehicle.Get('HX022-6O'), 'The old number is no longer a vehicle');
        Vehicle.Get('HX022-6N');
        Assert.AreEqual(45210, Vehicle.Mileage, 'Mileage is kept');
        Assert.AreEqual(Vehicle.Strategy::"Heavy Duty", Vehicle.Strategy, 'Maintenance strategy is kept');
        Assert.AreEqual('HX022-P6', Vehicle."Service Plan Code", 'Service plan is kept');
        Assert.AreEqual(40000, Vehicle."Last Service Km", 'Last service km is kept');
        Assert.AreEqual(20270115D, Vehicle."Last Service Date", 'Last service date is kept');
        Assert.AreEqual(55.5, Vehicle."Daily Rate", 'Daily rate is kept');
        Assert.AreEqual('HX022 box van', Vehicle.Description, 'Description is kept');
    end;

    [Test]
    procedure TakenNumberRefused()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LeaseContract: Record "CGR Lease Contract";
        Runner: Codeunit "HX022 Renumber Runner";
        Ok: Boolean;
    begin
        InitRun();
        NewVehicle('HX022-7N');
        Vehicle.Get('HX022-7N');
        Vehicle.Mileage := 777;
        Vehicle.Modify();
        NewVehicle('HX022-7O');
        InsertRentalContract('HX022-7C', 'HX022-7O');
        InsertLease('HX022-7L', 'HX022-7O');
        Commit();

        Runner.SetRenumberPair('HX022-7O', 'HX022-7N');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Changing to a number that is already a vehicle fails');
        Assert.ExpectedError('Vehicle HX022-7N already exists.');
        Assert.IsTrue(Vehicle.Get('HX022-7O'), 'The vehicle keeps its old number');
        Vehicle.Get('HX022-7N');
        Assert.AreEqual(777, Vehicle.Mileage, 'The existing vehicle is unchanged');
        Contract.Get('HX022-7C');
        Assert.AreEqual('HX022-7O', Contract."Vehicle No.", 'The rental contract keeps the old number');
        LeaseContract.Get('HX022-7L');
        Assert.AreEqual('HX022-7O', LeaseContract."Vehicle No.", 'The lease contract keeps the old number');
    end;

    [Test]
    procedure OtherVehicleUntouched()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        LeaseContract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Entry: Record "CGR Outbox Entry";
        DamageEntry: Record "CGR Damage Entry";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        DamageMgt: Codeunit "CGR Damage Mgt";
        OwnOutboxNo: Integer;
        OtherOutboxNo: Integer;
        OtherDamageNo: Integer;
    begin
        InitRun();
        ClearVehicle('HX022-8N');
        NewVehicle('HX022-8O');
        NewVehicle('HX022-8X');
        InsertRentalContract('HX022-8C', 'HX022-8O');
        InsertRentalContract('HX022-8XC', 'HX022-8X');
        InsertInvoicedLease('HX022-8L', 'HX022-8O');
        InsertInvoicedLease('HX022-8XL', 'HX022-8X');
        OwnOutboxNo := QueueOutbox('HX022-8O');
        OtherOutboxNo := QueueOutbox('HX022-8X');
        OtherDamageNo := DamageMgt.RegisterDamage('HX022-8X', 'HX022 scratched bumper');

        FleetMgt.ChangeVehicleNo('HX022-8O', 'HX022-8N');

        Assert.IsTrue(Vehicle.Get('HX022-8X'), 'The other vehicle keeps its number');
        Contract.Get('HX022-8XC');
        Assert.AreEqual('HX022-8X', Contract."Vehicle No.", 'The other rental contract is untouched');
        LeaseContract.Get('HX022-8XL');
        Assert.AreEqual('HX022-8X', LeaseContract."Vehicle No.", 'The other lease is untouched');
        InvoiceLine.Get('HX022-8XL', 10000);
        Assert.AreEqual('HX022-8X', InvoiceLine."Vehicle No.", 'The other lease invoice line is untouched');
        Entry.Get(OtherOutboxNo);
        Assert.AreEqual('HX022-8X', Entry."Vehicle No.", 'The other outbox entry is untouched');
        DamageEntry.Get(OtherDamageNo);
        Assert.AreEqual('HX022-8X', DamageEntry."Vehicle No.", 'The other damage entry is untouched');

        Contract.Get('HX022-8C');
        Assert.AreEqual('HX022-8N', Contract."Vehicle No.", 'The renumbered vehicle''s rental contract moved');
        LeaseContract.Get('HX022-8L');
        Assert.AreEqual('HX022-8N', LeaseContract."Vehicle No.", 'The renumbered vehicle''s lease moved');
        InvoiceLine.Get('HX022-8L', 10000);
        Assert.AreEqual('HX022-8N', InvoiceLine."Vehicle No.", 'The renumbered vehicle''s lease invoice line moved');
        Entry.Get(OwnOutboxNo);
        Assert.AreEqual('HX022-8N', Entry."Vehicle No.", 'The renumbered vehicle''s outbox entry moved');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure ClearVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        LeaseContract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Entry: Record "CGR Outbox Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        InvoiceLine.SetRange("Vehicle No.", VehicleNo);
        InvoiceLine.DeleteAll();
        LeaseContract.SetRange("Vehicle No.", VehicleNo);
        if LeaseContract.FindSet() then
            repeat
                ClearLease(LeaseContract."No.");
            until LeaseContract.Next() = 0;
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
    end;

    local procedure NewVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        ClearVehicle(VehicleNo);
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 40;
        Vehicle.Insert();
    end;

    local procedure ClearLease(LeaseNo: Code[20])
    var
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        if LeaseContract.Get(LeaseNo) then
            LeaseContract.Delete();
    end;

    local procedure InsertRentalContract(ContractNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.SetRange("Contract No.", ContractNo);
        LedgerEntry.DeleteAll();
        if Contract.Get(ContractNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := ContractNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := 'HX022 Customer';
        Contract."Start Date" := 20270301D;
        Contract."End Date" := 20270303D;
        Contract.Insert();
    end;

    local procedure InsertLedgerEntry(ContractNo: Code[20]; VehicleNo: Code[20]): Integer
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Contract No." := ContractNo;
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := 20270303D;
        LedgerEntry.Amount := 120;
        LedgerEntry."Km Driven" := 150;
        LedgerEntry.Insert();
        exit(LedgerEntry."Entry No.");
    end;

    local procedure InsertLease(LeaseNo: Code[20]; VehicleNo: Code[20])
    var
        LeaseContract: Record "CGR Lease Contract";
    begin
        ClearLease(LeaseNo);
        LeaseContract.Init();
        LeaseContract."No." := LeaseNo;
        LeaseContract."Vehicle No." := VehicleNo;
        LeaseContract."Customer Name" := 'HX022 Customer';
        LeaseContract."Start Date" := 20270301D;
        LeaseContract.Months := 3;
        LeaseContract."Base Rate" := 100;
        LeaseContract.Insert();
    end;

    local procedure InsertInvoicedLease(LeaseNo: Code[20]; VehicleNo: Code[20])
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InsertLease(LeaseNo, VehicleNo);
        LeaseMgt.CreateSchedule(LeaseNo);
        Assert.AreEqual(1, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270301D), 'The first lease line is invoiced');
    end;

    local procedure QueueOutbox(VehicleNo: Code[20]): Integer
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
        Entry.SetRange("Vehicle No.", VehicleNo);
        Entry.FindLast();
        exit(Entry."Entry No.");
    end;
}
