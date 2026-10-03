codeunit 80074 "CGR Lease Invoicing Run Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CustomerNameTxt: Label 'Nordlys Logistik', Locked = true;

    [Test]
    procedure LinesDueUpToDateAreInvoiced()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270314D);
        CreateLeaseHeader('T-LIR-L01', 'T-LIR-V01');
        AddScheduleLine('T-LIR-L01', 10000, 20270301D, 100);
        AddScheduleLine('T-LIR-L01', 20000, 20270306D, 100);
        AddScheduleLine('T-LIR-L01', 30000, 20270307D, 100);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIR-L01', 20270306D), 'Lines due on or before Saturday are invoiced');
        InvoiceLine.SetRange("Contract No.", 'T-LIR-L01');
        Assert.AreEqual(2, InvoiceLine.Count(), 'One invoice line per invoiced schedule line');
        InvoiceLine.Get('T-LIR-L01', 20000);
        Assert.AreEqual(20270308D, InvoiceLine."Invoice Date", 'Saturday due date invoiced on Monday');
        ScheduleLine.Get('T-LIR-L01', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'Line due on the up-to date is marked invoiced');
        ScheduleLine.Get('T-LIR-L01', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'Line due the day after is not invoiced');
        Assert.IsFalse(InvoiceLine.Get('T-LIR-L01', 30000), 'No invoice line for the line due the day after');

        Assert.AreEqual(0, LeaseInvoicing.InvoiceDueLines('T-LIR-L01', 20270306D), 'Invoiced lines are not invoiced again');
        Assert.AreEqual(1, LeaseInvoicing.InvoiceDueLines('T-LIR-L01', 20270307D), 'The Sunday line is due on Sunday');
        InvoiceLine.Get('T-LIR-L01', 30000);
        Assert.AreEqual(20270308D, InvoiceLine."Invoice Date", 'Sunday due date invoiced on Monday');
    end;

    [Test]
    procedure InvoiceLineCarriesLeaseData()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.05, '', 3);
        Lib.ClearNonWorkingDays(20270801D, 20270815D);
        CreateLeaseHeader('T-LIR-L02', 'T-LIR-V02');
        AddScheduleLine('T-LIR-L02', 10000, 20270802D, 100.12);
        AddScheduleLine('T-LIR-L02', 20000, 20270803D, 100.13);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIR-L02', 20270803D), 'Both lines invoiced');
        InvoiceLine.Get('T-LIR-L02', 10000);
        Assert.AreEqual('T-LIR-L02', InvoiceLine."Contract No.", 'Contract of the lease');
        Assert.AreEqual(10000, InvoiceLine."Schedule Line No.", 'Schedule line of the invoice line');
        Assert.AreEqual('T-LIR-V02', InvoiceLine."Vehicle No.", 'Vehicle of the lease');
        Assert.AreEqual(CustomerNameTxt, InvoiceLine."Customer Name", 'Customer of the lease');
        Assert.AreEqual(20270802D, InvoiceLine."Due Date", 'Due date of the schedule line');
        Assert.AreEqual(20270802D, InvoiceLine."Invoice Date", 'A working due date is the invoice date');
        Assert.AreEqual(100.1, InvoiceLine.Amount, '100.12 rounded to 0.05');
        InvoiceLine.Get('T-LIR-L02', 20000);
        Assert.AreEqual(100.15, InvoiceLine.Amount, '100.13 rounded to 0.05');
    end;

    [Test]
    procedure WeekdayHolidayDueDateMoves()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270901D, 20270930D);
        Lib.AddNonWorkingDay(20270908D);
        Lib.AddNonWorkingDay(20270910D);
        CreateLeaseHeader('T-LIR-L03', 'T-LIR-V03');
        AddScheduleLine('T-LIR-L03', 10000, 20270907D, 100);
        AddScheduleLine('T-LIR-L03', 20000, 20270908D, 100);
        AddScheduleLine('T-LIR-L03', 30000, 20270910D, 100);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('T-LIR-L03', 20270910D), 'Three lines due');
        InvoiceLine.Get('T-LIR-L03', 10000);
        Assert.AreEqual(20270907D, InvoiceLine."Invoice Date", 'Working Tuesday kept');
        InvoiceLine.Get('T-LIR-L03', 20000);
        Assert.AreEqual(20270909D, InvoiceLine."Invoice Date", 'Wednesday holiday moves to Thursday');
        InvoiceLine.Get('T-LIR-L03', 30000);
        Assert.AreEqual(20270913D, InvoiceLine."Invoice Date", 'Friday holiday moves to Monday');
    end;

    [Test]
    procedure HolidaysInARowAfterWeekend()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270601D, 20270630D);
        Lib.AddNonWorkingDay(20270607D);
        Lib.AddNonWorkingDay(20270608D);
        Lib.AddNonWorkingDay(20270610D);
        Lib.AddNonWorkingDay(20270611D);
        CreateLeaseHeader('T-LIR-L04', 'T-LIR-V04');
        AddScheduleLine('T-LIR-L04', 10000, 20270605D, 100);
        AddScheduleLine('T-LIR-L04', 20000, 20270610D, 100);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIR-L04', 20270630D), 'Both lines due');
        InvoiceLine.Get('T-LIR-L04', 10000);
        Assert.AreEqual(20270609D, InvoiceLine."Invoice Date", 'Saturday, Sunday, Monday and Tuesday skipped');
        InvoiceLine.Get('T-LIR-L04', 20000);
        Assert.AreEqual(20270614D, InvoiceLine."Invoice Date", 'Thursday, Friday and the weekend skipped');
    end;

    [Test]
    procedure BeforeEventSeesCompleteLine()
    var
        SeenLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Lease Invoice Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.05, '', 3);
        Lib.ClearNonWorkingDays(20270401D, 20270415D);
        CreateLeaseHeader('T-LIR-L05', 'T-LIR-V05');
        AddScheduleLine('T-LIR-L05', 10000, 20270403D, 100.12);
        BindSubscription(Spy);

        Assert.AreEqual(1, LeaseInvoicing.InvoiceDueLines('T-LIR-L05', 20270415D), 'One line invoiced');
        UnbindSubscription(Spy);
        Assert.AreEqual(1, Spy.BeforeHitCount(), 'Before event raised once');
        Spy.GetSeenBeforeLine(SeenLine);
        Assert.AreEqual('T-LIR-L05', SeenLine."Contract No.", 'Before event sees the contract');
        Assert.AreEqual(10000, SeenLine."Schedule Line No.", 'Before event sees the schedule line');
        Assert.AreEqual('T-LIR-V05', SeenLine."Vehicle No.", 'Before event sees the vehicle');
        Assert.AreEqual(CustomerNameTxt, SeenLine."Customer Name", 'Before event sees the customer');
        Assert.AreEqual(20270403D, SeenLine."Due Date", 'Before event sees the due date');
        Assert.AreEqual(20270405D, SeenLine."Invoice Date", 'Before event sees the invoice date');
        Assert.AreEqual(100.1, SeenLine.Amount, 'Before event sees the rounded amount');
    end;

    [Test]
    procedure SubscriberChangeIsInserted()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Lease Invoice Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20271001D, 20271031D);
        CreateLeaseHeader('T-LIR-L06', 'T-LIR-V06');
        AddScheduleLine('T-LIR-L06', 10000, 20271004D, 100);
        Spy.SetLineChange(250, 20271029D);
        BindSubscription(Spy);

        Assert.AreEqual(1, LeaseInvoicing.InvoiceDueLines('T-LIR-L06', 20271015D), 'One line invoiced');
        UnbindSubscription(Spy);
        InvoiceLine.Get('T-LIR-L06', 10000);
        Assert.AreEqual(250, InvoiceLine.Amount, 'Amount changed by the subscriber is inserted');
        Assert.AreEqual(20271029D, InvoiceLine."Invoice Date", 'Invoice date changed by the subscriber is inserted');
    end;

    [Test]
    procedure HandledLineIsNotInserted()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "CGR Lease Invoice Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20271101D, 20271115D);
        CreateLeaseHeader('T-LIR-L07', 'T-LIR-V07');
        AddScheduleLine('T-LIR-L07', 10000, 20271101D, 100);
        AddScheduleLine('T-LIR-L07', 20000, 20271102D, 100);
        Spy.SetHandleLines(true);
        BindSubscription(Spy);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIR-L07', 20271115D), 'Handled lines still count');
        UnbindSubscription(Spy);
        InvoiceLine.SetRange("Contract No.", 'T-LIR-L07');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A handled line is not inserted');
        ScheduleLine.SetRange("Contract No.", 'T-LIR-L07');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(2, ScheduleLine.Count(), 'Handled schedule lines are marked invoiced');
        Assert.AreEqual(2, Spy.BeforeHitCount(), 'Before event raised per line');
        Assert.AreEqual(0, Spy.AfterHitCount(), 'No after event for a handled line');
    end;

    [Test]
    procedure AfterEventFindsInsertedLine()
    var
        Spy: Codeunit "CGR Lease Invoice Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20271201D, 20271215D);
        CreateLeaseHeader('T-LIR-L08', 'T-LIR-V08');
        AddScheduleLine('T-LIR-L08', 10000, 20271201D, 100);
        AddScheduleLine('T-LIR-L08', 20000, 20271202D, 100);
        BindSubscription(Spy);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIR-L08', 20271215D), 'Two lines invoiced');
        UnbindSubscription(Spy);
        Assert.AreEqual(2, Spy.AfterHitCount(), 'After event raised per inserted line');
        Assert.AreEqual(2, Spy.AfterLinesFoundCount(), 'The after event finds each line in the database');
    end;

    local procedure CreateLeaseHeader(LeaseNo: Code[20]; VehicleNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := VehicleNo;
        Contract."Customer Name" := CustomerNameTxt;
        Contract."Start Date" := 20270101D;
        Contract.Months := 12;
        Contract."Base Rate" := 100;
        Contract.Insert();
    end;

    local procedure AddScheduleLine(LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Init();
        ScheduleLine."Contract No." := LeaseNo;
        ScheduleLine."Line No." := LineNo;
        ScheduleLine."Due Date" := DueDate;
        ScheduleLine.Amount := LineAmount;
        ScheduleLine.Insert();
    end;
}
