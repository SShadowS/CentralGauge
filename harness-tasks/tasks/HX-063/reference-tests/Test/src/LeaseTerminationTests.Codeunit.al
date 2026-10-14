codeunit 80111 "CGR Lease Termination Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure TerminateOnDueDateRepricesLinesLeft()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        SetUp();
        ContractNo := NewLease('HX063-V01');
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(6, Line.Count(), 'Arrange: six schedule lines');
        Line.SetFilter(Amount, '<>%1', 106);
        Assert.IsTrue(Line.IsEmpty(), 'Arrange: every line is 106.00 before the termination');
        Line.SetRange(Amount);

        Termination.TerminateLease(ContractNo, 20270415D);

        Assert.AreEqual(4, Line.Count(), 'Lines due after the last due date are deleted');
        Assert.IsTrue(Line.Get(ContractNo, 40000), 'The line due on the last due date stays');
        Assert.AreEqual(20270415D, Line."Due Date", 'Line 40000 is due on the last due date');
        Assert.IsFalse(Line.Get(ContractNo, 50000), 'The line due after the last due date is deleted');
        Contract.Get(ContractNo);
        Assert.AreEqual(4, Contract.Months, 'Months is the number of lines left');
        Line.Get(ContractNo, 10000);
        Assert.IsTrue(Line.Invoiced, 'The invoiced line stays invoiced');
        Assert.AreEqual(106, Line.Amount, 'The invoiced line keeps its amount');
        Assert.AreEqual(104, LeaseMgt.MonthlyRate(100, 4), 'Arrange: the four-month rate is 104.00');
        Line.Get(ContractNo, 20000);
        Assert.AreEqual(104, Line.Amount, 'Line 20000 gets the four-month rate');
        Line.Get(ContractNo, 30000);
        Assert.AreEqual(104, Line.Amount, 'Line 30000 gets the four-month rate');
        Line.Get(ContractNo, 40000);
        Assert.AreEqual(104, Line.Amount, 'Line 40000 gets the four-month rate');
    end;

    [Test]
    procedure TerminateOnInvoicedDueDateKeepsIt()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        SetUp();
        ContractNo := NewLease('HX063-V02');
        LeaseMgt.InvoiceLine(ContractNo, 30000);
        Line.Get(ContractNo, 20000);
        Assert.AreEqual(106, Line.Amount, 'Arrange: line 20000 is 106.00 before the termination');

        Termination.TerminateLease(ContractNo, 20270315D);

        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(3, Line.Count(), 'Three lines are left');
        Contract.Get(ContractNo);
        Assert.AreEqual(3, Contract.Months, 'Months is the number of lines left');
        Assert.IsTrue(Line.Get(ContractNo, 30000), 'The invoiced line due on the last due date stays');
        Assert.IsTrue(Line.Invoiced, 'Line 30000 stays invoiced');
        Assert.AreEqual(106, Line.Amount, 'The invoiced line keeps its amount');
        Assert.IsFalse(Line.Get(ContractNo, 40000), 'The line due after the last due date is deleted');
        Line.Get(ContractNo, 10000);
        Assert.AreEqual(103, Line.Amount, 'Line 10000 gets the three-month rate');
        Line.Get(ContractNo, 20000);
        Assert.AreEqual(103, Line.Amount, 'Line 20000 gets the three-month rate');
    end;

    [Test]
    procedure TerminateBeforeStartFails()
    var
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        SetUp();
        ContractNo := NewLease('HX063-V03');

        asserterror Termination.TerminateLease(ContractNo, 20270114D);

        Assert.ExpectedError(StrSubstNo('Lease %1 cannot end before it starts.', ContractNo));
    end;

    [Test]
    procedure TerminateBeforeInvoicedLineFails()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Termination: Codeunit "CGR Lease Termination";
        ContractNo: Code[20];
    begin
        SetUp();
        ContractNo := NewLease('HX063-V04');
        LeaseMgt.InvoiceLine(ContractNo, 40000);

        asserterror Termination.TerminateLease(ContractNo, 20270315D);

        Assert.ExpectedError(StrSubstNo('Lease %1 is invoiced after 2027-03-15.', ContractNo));
    end;

    [Test]
    procedure TerminateUnknownLeaseFails()
    var
        Contract: Record "CGR Lease Contract";
        Termination: Codeunit "CGR Lease Termination";
    begin
        SetUp();
        Assert.IsFalse(Contract.Get('HX063-NOLEASE'), 'Arrange: the lease does not exist');

        asserterror Termination.TerminateLease('HX063-NOLEASE', 20270415D);
    end;

    local procedure SetUp()
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure NewLease(VehicleNo: Code[20]): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease(VehicleNo, 20270115D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);
        exit(ContractNo);
    end;
}
