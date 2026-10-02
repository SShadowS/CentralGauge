codeunit 80030 "CGR Leasing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure LeaseRateUsesCoreInternal()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Expected: Decimal;
    begin
        Expected := 112;
        Assert.AreEqual(Expected, LeaseMgt.MonthlyRate(100, 12), '12 months adds 12 percent');
    end;

    [Test]
    procedure ScheduleHasOneLinePerMonthWithStandardLineNumbers()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        Months: Integer;
        i: Integer;
    begin
        Months := 12;
        ContractNo := Lib.CreateLease('T-LEASE-001', 20270131D, Months, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(Months, Line.Count(), 'One line per month');

        Line.SetCurrentKey("Contract No.", "Line No.");
        Line.Ascending(true);
        Line.FindSet();
        for i := 1 to Months do begin
            Assert.AreEqual(i * 10000, Line."Line No.", 'Line numbers increase by 10000');
            if i < Months then
                Line.Next();
        end;
    end;

    [Test]
    procedure FirstInstallmentIsDueOnLeaseStartDate()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        StartDate: Date;
    begin
        StartDate := 20270315D;
        ContractNo := Lib.CreateLease('T-LEASE-002', StartDate, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        Line.Get(ContractNo, 10000);
        Assert.AreEqual(StartDate, Line."Due Date", 'First installment due on the lease start date');
    end;

    [Test]
    procedure InstallmentDueDatesAreCountedInWholeMonthsFromStartDateWithoutDrift()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        StartDate: Date;
        ExpectedDueDate: Date;
        Months: Integer;
        i: Integer;
    begin
        // A lease starting on the last day of January must keep landing on the
        // last day of each later month (e.g. 31 March), never drift to the 28th.
        StartDate := 20270131D;
        Months := 12;
        ContractNo := Lib.CreateLease('T-LEASE-003', StartDate, Months, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        for i := 1 to Months do begin
            Line.Get(ContractNo, i * 10000);
            ExpectedDueDate := CalcDate(StrSubstNo('<+%1M>', i - 1), StartDate);
            Assert.AreEqual(ExpectedDueDate, Line."Due Date",
                StrSubstNo('Installment %1 due date must be %2 months after the start date', i, i - 1));
        end;

        // Pin down the concrete case from the bug report explicitly.
        Line.Get(ContractNo, 30000);
        Assert.AreEqual(20270331D, Line."Due Date", 'March installment must be due on 31 March, not drift to the 28th');
    end;

    [Test]
    procedure InstallmentAmountsSplitTotalWithRemainderOnLastLine()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
        Months: Integer;
        BaseRate: Decimal;
        Total: Decimal;
        Installment: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Months := 7;
        BaseRate := 333.33;
        ContractNo := Lib.CreateLease('T-LEASE-004', 20270201D, Months, BaseRate);
        LeaseMgt.CreateSchedule(ContractNo);

        Total := Round(BaseRate * (1 + Months / 100) * Months, 0.01);
        Installment := Round(Total / Months, 0.01);

        Allocated := 0;
        for i := 1 to Months - 1 do begin
            Line.Get(ContractNo, i * 10000);
            Assert.AreEqual(Installment, Line.Amount, StrSubstNo('Installment %1 amount', i));
            Allocated += Line.Amount;
        end;

        Line.Get(ContractNo, Months * 10000);
        Assert.AreEqual(Total - Allocated, Line.Amount, 'Last installment takes the remainder');

        Line.SetRange("Contract No.", ContractNo);
        Line.CalcSums(Amount);
        Assert.AreEqual(Total, Line.Amount, 'Installments add up exactly to the lease total');
    end;

    [Test]
    procedure RecreatingScheduleReplacesExistingLines()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease('T-LEASE-005', 20270101D, 10, 100);
        LeaseMgt.CreateSchedule(ContractNo);

        Contract.Get(ContractNo);
        Contract.Months := 4;
        Contract."Base Rate" := 250;
        Contract.Modify(true);
        LeaseMgt.CreateSchedule(ContractNo);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(4, Line.Count(), 'Old lines are replaced by the new schedule');
        Assert.IsFalse(Line.Get(ContractNo, 50000), 'Lines from the previous schedule no longer exist');

        Line.Get(ContractNo, 40000);
        Assert.AreEqual(20270401D, Line."Due Date", 'Last line of the rebuilt schedule matches the current contract');
    end;

    [Test]
    procedure CannotRescheduleLeaseWithInvoicedLine()
    var
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease('T-LEASE-006', 20270101D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        Commit();

        asserterror LeaseMgt.CreateSchedule(ContractNo);
        Assert.ExpectedError(StrSubstNo('Lease %1 has invoiced schedule lines and cannot be rescheduled.', ContractNo));

        Line.Get(ContractNo, 10000);
        Assert.IsTrue(Line.Invoiced, 'Existing invoiced line is untouched');
    end;
}
