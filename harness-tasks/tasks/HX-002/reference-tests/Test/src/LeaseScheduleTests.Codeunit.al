codeunit 80100 "CGR Lease Schedule Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        InvoicedErr: Label 'Lease %1 has invoiced schedule lines and cannot be rescheduled.', Locked = true;

    [Test]
    procedure DueDatesFollowStartDate()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        Expected: array[12] of Date;
        i: Integer;
    begin
        ContractNo := Lib.CreateLease('T-LEASE-001', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        Expected[1] := 20270131D;
        Expected[2] := 20270228D;
        Expected[3] := 20270331D;
        Expected[4] := 20270430D;
        Expected[5] := 20270531D;
        Expected[6] := 20270630D;
        Expected[7] := 20270731D;
        Expected[8] := 20270831D;
        Expected[9] := 20270930D;
        Expected[10] := 20271031D;
        Expected[11] := 20271130D;
        Expected[12] := 20271231D;
        for i := 1 to 12 do begin
            Line.Get(ContractNo, i * 10000);
            Assert.AreEqual(Expected[i], Line."Due Date", StrSubstNo('Due date of installment %1', i));
        end;
    end;

    [Test]
    procedure LeapYearDueDates()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease('T-LEASE-002', 20280131D, 3, 100);
        LeaseMgt.CreateSchedule(ContractNo);
        Line.Get(ContractNo, 10000);
        Assert.AreEqual(20280131D, Line."Due Date", 'First installment is due on the start date');
        Line.Get(ContractNo, 20000);
        Assert.AreEqual(20280229D, Line."Due Date", 'Second installment falls on the leap day');
        Line.Get(ContractNo, 30000);
        Assert.AreEqual(20280331D, Line."Due Date", 'Third installment is due two months after the start');
    end;

    [Test]
    procedure OneLinePerMonthNumbered()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        i: Integer;
    begin
        ContractNo := Lib.CreateLease('T-LEASE-003', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(12, Line.Count(), 'One schedule line per month');
        Line.FindSet();
        for i := 1 to 12 do begin
            Assert.AreEqual(i * 10000, Line."Line No.", StrSubstNo('Line number of installment %1', i));
            if i < 12 then
                Line.Next();
        end;
    end;

    [Test]
    procedure SingleMonthLease()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease('T-LEASE-004', 20270228D, 1, 100);
        LeaseMgt.CreateSchedule(ContractNo);
        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(1, Line.Count(), 'A one-month lease has one line');
        Line.FindFirst();
        Assert.AreEqual(10000, Line."Line No.", 'Line number');
        Assert.AreEqual(20270228D, Line."Due Date", 'Due on the start date');
        Assert.AreEqual(101.00, Line.Amount, '100 x 1 month x factor 1.01');
    end;

    [Test]
    procedure InstallmentsCarryRoundingToLastLine()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        i: Integer;
    begin
        ContractNo := Lib.CreateLease('T-LEASE-005', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        for i := 1 to 11 do begin
            Line.Get(ContractNo, i * 10000);
            Assert.AreEqual(11.28, Line.Amount, StrSubstNo('Installment %1 is the rounded share', i));
        end;
        Line.Get(ContractNo, 120000);
        Assert.AreEqual(11.26, Line.Amount, 'The last installment takes the remainder');
        Line.SetRange("Contract No.", ContractNo);
        Line.CalcSums(Amount);
        Assert.AreEqual(135.34, Line.Amount, 'Installments add up to the lease total');
    end;

    [Test]
    procedure RescheduleReplacesLines()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        i: Integer;
    begin
        ContractNo := Lib.CreateLease('T-LEASE-006', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        Contract.Get(ContractNo);
        Contract.Months := 6;
        Contract."Base Rate" := 20;
        Contract.Modify();
        LeaseMgt.CreateSchedule(ContractNo);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(6, Line.Count(), 'The new schedule has one line per month of the changed lease');
        for i := 1 to 6 do begin
            Line.Get(ContractNo, i * 10000);
            Assert.AreEqual(21.20, Line.Amount, StrSubstNo('Installment %1 of the new schedule', i));
        end;
        Line.CalcSums(Amount);
        Assert.AreEqual(127.20, Line.Amount, 'New schedule adds up to 20 x 1.06 x 6');
        Line.SetFilter("Line No.", '>%1', 60000);
        Assert.IsTrue(Line.IsEmpty(), 'No line of the old schedule is left');
    end;

    [Test]
    procedure InvoicedLeaseCannotBeRescheduled()
    var
        Contract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease('T-LEASE-007', 20270131D, 12, 10.07);
        LeaseMgt.CreateSchedule(ContractNo);
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        Contract.Get(ContractNo);
        Contract.Months := 6;
        Contract.Modify();
        asserterror LeaseMgt.CreateSchedule(ContractNo);
        Assert.ExpectedError(StrSubstNo(InvoicedErr, ContractNo));
    end;
}
