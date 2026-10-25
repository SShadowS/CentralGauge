/// <summary>
/// Q-06 scale scenario for HX-022 (harness-owned, private; never a task test, never scored).
/// One vehicle with 100 records that refer to it, spread over the six tables the task names:
/// 15 rental contracts + 15 rental ledger entries, 10 lease contracts + 30 lease invoice lines,
/// 20 outbox entries (10 sent) and 10 damage entries.
///
/// Placed as the only source of the Test app (the Q-04 test-rerun path) and run with
/// `--sql-cost`, which counts SQL statements per [Test] method. Every method is self-contained:
/// it builds its own data under its own key tag (S for SetupOnly, C for the call), and starts by
/// clearing its own keys only. So no method sees another method's data, and the result depends
/// neither on the runner's isolation level nor on method order.
/// SetupOnly measures the setup alone; ChangeVehicleNo100 measures the same setup plus the one
/// call. The call's cost is the difference, taken per execution (the "Setup" name prefix marks
/// the baseline method).
/// Success only is asserted: the call completes and the vehicle exists under the new number.
/// Nothing about how the solution does it is checked.
/// </summary>
codeunit 84980 "CG Scale HX-022"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure SetupOnly()
    begin
        Setup100Linked('S');
    end;

    [Test]
    procedure ChangeVehicleNo100()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Setup100Linked('C');
        FleetMgt.ChangeVehicleNo(OldNo('C'), NewNo('C'));
        if not Vehicle.Get(NewNo('C')) then
            Error('Scenario: vehicle %1 does not exist after ChangeVehicleNo', NewNo('C'));
    end;

    local procedure OldNo(Tag: Text[1]): Code[20]
    begin
        exit(CopyStr('CGSQL-O' + Tag, 1, 20));
    end;

    local procedure NewNo(Tag: Text[1]): Code[20]
    begin
        exit(CopyStr('CGSQL-N' + Tag, 1, 20));
    end;

    local procedure KeyOf(Prefix: Text; Tag: Text[1]; I: Integer): Code[20]
    begin
        exit(CopyStr(StrSubstNo('CGSQL-%1%2-%3', Prefix, Tag, I), 1, 20));
    end;

    local procedure Setup100Linked(Tag: Text[1])
    begin
        InitRun();
        ClearVehicle(NewNo(Tag));
        NewVehicle(OldNo(Tag));
        AddRentals(OldNo(Tag), Tag, 15);
        AddLeases(OldNo(Tag), Tag, 10);
        AddOutbox(OldNo(Tag), 20);
        // Last: open damages block the vehicle, which the setup above must not meet.
        AddDamages(OldNo(Tag), 10);
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

    local procedure AddRentals(VehicleNo: Code[20]; Tag: Text[1]; N: Integer)
    var
        Contract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        I: Integer;
    begin
        for I := 1 to N do begin
            Contract.Init();
            Contract."No." := KeyOf('C', Tag, I);
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
    local procedure AddLeases(VehicleNo: Code[20]; Tag: Text[1]; N: Integer)
    var
        LeaseContract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
        I: Integer;
    begin
        for I := 1 to N do begin
            LeaseNo := KeyOf('L', Tag, I);
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
