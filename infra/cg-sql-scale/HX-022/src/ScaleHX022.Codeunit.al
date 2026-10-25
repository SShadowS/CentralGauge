/// <summary>
/// Q-06 scale scenario for HX-022 (harness-owned, private; never a task test, never scored).
/// One vehicle with 100 records that refer to it, spread over the six tables the task names:
/// 15 rental contracts + 15 rental ledger entries, 10 lease contracts + 30 lease invoice lines,
/// 20 outbox entries (10 sent) and 10 damage entries.
///
/// Placed as the only source of the Test app (the Q-04 test-rerun path) and run with
/// `--sql-cost`, which counts SQL statements per [Test] method. Two methods, run in this order:
/// Setup100Linked builds the data, ChangeVehicleNo100 makes the one call, so its count is the
/// call plus the constant per-method overhead. The runner rolls back after the codeunit, not
/// after each method, so the data of the first method is there for the second.
/// Success only is asserted: the call completes and the vehicle exists under the new number.
/// Nothing about how the solution does it is checked.
/// </summary>
codeunit 84980 "CG Scale HX-022"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        OldNoTok: Label 'CGSQL-O', Locked = true;
        NewNoTok: Label 'CGSQL-N', Locked = true;

    [Test]
    procedure Setup100Linked()
    begin
        InitRun();
        ClearVehicle(NewNoTok);
        NewVehicle(OldNoTok);
        AddRentals(OldNoTok, 15);
        AddLeases(OldNoTok, 10);
        AddOutbox(OldNoTok, 20);
        // Last: open damages block the vehicle, which the setup above must not meet.
        AddDamages(OldNoTok, 10);
    end;

    [Test]
    procedure ChangeVehicleNo100()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        if not Vehicle.Get(OldNoTok) then
            Error('Scenario: Setup100Linked did not leave vehicle %1', OldNoTok);
        FleetMgt.ChangeVehicleNo(OldNoTok, NewNoTok);
        if not Vehicle.Get(NewNoTok) then
            Error('Scenario: vehicle %1 does not exist after ChangeVehicleNo', NewNoTok);
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
        ScheduleLine: Record "CGR Lease Schedule Line";
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
                ScheduleLine.SetRange("Contract No.", LeaseContract."No.");
                ScheduleLine.DeleteAll();
            until LeaseContract.Next() = 0;
        LeaseContract.DeleteAll();
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

    local procedure AddRentals(VehicleNo: Code[20]; N: Integer)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        I: Integer;
    begin
        for I := 1 to N do begin
            Contract.Init();
            Contract."No." := CopyStr(StrSubstNo('CGSQL-C%1', I), 1, MaxStrLen(Contract."No."));
            if Contract.Get(Contract."No.") then
                Contract.Delete();
            Contract."Vehicle No." := VehicleNo;
            Contract."Customer Name" := 'CGSQL Customer';
            Contract."Start Date" := 20270301D;
            Contract."End Date" := 20270303D;
            Contract.Insert();

            LedgerEntry.Init();
            LedgerEntry."Contract No." := Contract."No.";
            LedgerEntry."Vehicle No." := VehicleNo;
            LedgerEntry."Posting Date" := 20270303D;
            LedgerEntry.Amount := 120;
            LedgerEntry."Km Driven" := 150;
            LedgerEntry.Insert();
        end;
    end;

    /// <summary>Each lease has a 3-month schedule, all 3 lines invoiced: 1 lease + 3 invoice lines per lease.</summary>
    local procedure AddLeases(VehicleNo: Code[20]; N: Integer)
    var
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
        I: Integer;
    begin
        for I := 1 to N do begin
            LeaseNo := CopyStr(StrSubstNo('CGSQL-L%1', I), 1, MaxStrLen(LeaseNo));
            ScheduleLine.SetRange("Contract No.", LeaseNo);
            ScheduleLine.DeleteAll();
            InvoiceLine.SetRange("Contract No.", LeaseNo);
            InvoiceLine.DeleteAll();
            if LeaseContract.Get(LeaseNo) then
                LeaseContract.Delete();
            LeaseContract.Init();
            LeaseContract."No." := LeaseNo;
            LeaseContract."Vehicle No." := VehicleNo;
            LeaseContract."Customer Name" := 'CGSQL Customer';
            LeaseContract."Start Date" := 20270301D;
            LeaseContract.Months := 3;
            LeaseContract."Base Rate" := 100;
            LeaseContract.Insert();
            LeaseMgt.CreateSchedule(LeaseNo);
            if LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270601D) <> 3 then
                Error('Scenario setup: lease %1 did not invoice its 3 schedule lines', LeaseNo);
        end;
    end;

    /// <summary>Half of the entries are marked sent, as in the task's sent and pending outbox entries.</summary>
    local procedure AddOutbox(VehicleNo: Code[20]; N: Integer)
    var
        Entry: Record "CGR Outbox Entry";
        Facade: Codeunit "CGR Integration Facade";
        I: Integer;
    begin
        for I := 1 to N do begin
            Facade.QueueVehicleCheckedOut(VehicleNo);
            if I mod 2 = 0 then begin
                Entry.SetRange("Vehicle No.", VehicleNo);
                Entry.FindLast();
                Facade.MarkSent(Entry."Entry No.");
            end;
        end;
    end;

    local procedure AddDamages(VehicleNo: Code[20]; N: Integer)
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        I: Integer;
    begin
        for I := 1 to N do
            DamageMgt.RegisterDamage(VehicleNo, CopyStr(StrSubstNo('CGSQL damage %1', I), 1, 100));
    end;
}
