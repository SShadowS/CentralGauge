codeunit 80147 "CGR Due Plan Naive B"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PlanSkipsInvoicedAndKeepsWindow()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
        DuePlan: Codeunit "CGR Lease Due Plan";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        CreateLeaseSchedule('HX089-N2', 20270301D, 3);
        LeaseMgt.InvoiceLine('HX089-N2', 20000);
        CreateLeaseSchedule('HX089-N3', 20270215D, 4);
        CreateLeaseSchedule('HX089-N4', 20270310D, 1);

        DuePlan.FillDuePlan('HX089-N2|HX089-N3', 20270301D, 20270501D, TempPlanLine);

        Assert.AreEqual(4, TempPlanLine.Count(), 'Open lease months inside the window');
        AssertMonth(TempPlanLine, 'HX089-N2', 3, 103);
        AssertMonth(TempPlanLine, 'HX089-N2', 5, 103);
        AssertMonth(TempPlanLine, 'HX089-N3', 3, 104);
        AssertMonth(TempPlanLine, 'HX089-N3', 4, 104);
    end;

    local procedure CreateLeaseSchedule(LeaseNo: Code[20]; StartDate: Date; LeaseMonths: Integer)
    var
        Lease: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Lease.Get(LeaseNo) then
            Lease.Delete();
        Lease.Init();
        Lease."No." := LeaseNo;
        Lease."Start Date" := StartDate;
        Lease.Months := LeaseMonths;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    local procedure AssertMonth(var TempPlanLine: Record "CGR Due Plan Line" temporary; LeaseNo: Code[20]; DueMonth: Integer; ExpectedAmount: Decimal)
    begin
        TempPlanLine.Reset();
        TempPlanLine.SetRange("Contract No.", LeaseNo);
        TempPlanLine.SetRange("Due Month", DueMonth);
        Assert.IsTrue(TempPlanLine.FindFirst(), StrSubstNo('Plan line %1 month %2', LeaseNo, DueMonth));
        Assert.AreEqual(ExpectedAmount, TempPlanLine.Amount, 'Installment amount');
        Assert.AreEqual(1, TempPlanLine.Lines, 'One installment per month');
        TempPlanLine.Reset();
    end;
}
