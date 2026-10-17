codeunit 80145 "CGR Due Plan Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PlanHasOneLinePerLeaseAndMonth()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        LeaseA: Code[20];
        LeaseB: Code[20];
        LeaseX: Code[20];
        DueMonth: Integer;
    begin
        FillScenario('1', LeaseA, LeaseB, LeaseX, TempPlanLine);

        TempPlanLine.Reset();
        Assert.AreEqual(13, TempPlanLine.Count(), 'Twelve open months of lease A and one of lease B');
        AssertPlanLine(TempPlanLine, LeaseA, 2027, 3, 114.13, 1);
        for DueMonth := 5 to 12 do
            AssertPlanLine(TempPlanLine, LeaseA, 2027, DueMonth, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseA, 2028, 1, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseA, 2028, 2, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseA, 2028, 3, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseB, 2027, 3, 113, 2);
    end;

    [Test]
    procedure InvoicedInstallmentIsNotPlanned()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseA: Code[20];
        LeaseB: Code[20];
        LeaseX: Code[20];
    begin
        FillScenario('2', LeaseA, LeaseB, LeaseX, TempPlanLine);

        ScheduleLine.Get(LeaseA, 20000);
        Assert.AreEqual(20270401D, ScheduleLine."Due Date", 'Lease A has an installment due in April 2027');
        Assert.IsTrue(ScheduleLine.Invoiced, 'The April 2027 installment of lease A is invoiced');
        TempPlanLine.Reset();
        Assert.IsFalse(TempPlanLine.Get(LeaseA, 2027, 4), 'A month with only an invoiced installment gets no plan line');
        AssertPlanLine(TempPlanLine, LeaseA, 2027, 5, 114.13, 1);
    end;

    [Test]
    procedure WindowIncludesBothBoundaryDays()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseA: Code[20];
        LeaseB: Code[20];
        LeaseX: Code[20];
    begin
        FillScenario('3', LeaseA, LeaseB, LeaseX, TempPlanLine);

        ScheduleLine.SetRange("Contract No.", LeaseB);
        ScheduleLine.SetFilter("Due Date", '<%1', 20270301D);
        Assert.AreEqual(2, ScheduleLine.Count(), 'Lease B has open installments before the window');
        TempPlanLine.Reset();
        AssertPlanLine(TempPlanLine, LeaseA, 2027, 3, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseA, 2028, 3, 114.13, 1);
        Assert.IsFalse(TempPlanLine.Get(LeaseB, 2027, 1), 'A line due before the window is not planned (January)');
        Assert.IsFalse(TempPlanLine.Get(LeaseB, 2027, 2), 'A line due before the window is not planned (February)');
    end;

    [Test]
    procedure SameMonthOfTwoYearsIsTwoLines()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        LeaseA: Code[20];
        LeaseB: Code[20];
        LeaseX: Code[20];
    begin
        FillScenario('4', LeaseA, LeaseB, LeaseX, TempPlanLine);

        TempPlanLine.Reset();
        TempPlanLine.SetRange("Contract No.", LeaseA);
        TempPlanLine.SetRange("Due Month", 3);
        Assert.AreEqual(2, TempPlanLine.Count(), 'March 2027 and March 2028 are separate plan lines');
        TempPlanLine.Reset();
        AssertPlanLine(TempPlanLine, LeaseA, 2027, 3, 114.13, 1);
        AssertPlanLine(TempPlanLine, LeaseA, 2028, 3, 114.13, 1);
    end;

    [Test]
    procedure OnlyFilteredLeasesOfThisFill()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseA: Code[20];
        LeaseB: Code[20];
        LeaseX: Code[20];
    begin
        FillScenario('5', LeaseA, LeaseB, LeaseX, TempPlanLine);

        ScheduleLine.SetRange("Contract No.", LeaseX);
        ScheduleLine.SetRange("Due Date", 20270301D, 20270331D);
        ScheduleLine.SetRange(Invoiced, false);
        Assert.AreEqual(1, ScheduleLine.Count(), 'Lease X has an open installment in March 2027');
        TempPlanLine.Reset();
        TempPlanLine.SetRange("Contract No.", LeaseX);
        Assert.IsTrue(TempPlanLine.IsEmpty(), 'A lease outside the contract filter is not planned');
        TempPlanLine.Reset();
        Assert.IsFalse(TempPlanLine.Get('HX089-OLD', 2027, 1), 'A line from before the fill is gone');
        TempPlanLine.SetFilter("Contract No.", '<>%1&<>%2', LeaseA, LeaseB);
        Assert.IsTrue(TempPlanLine.IsEmpty(), 'Only the leases of the filter are planned');
    end;

    local procedure FillScenario(Suffix: Text; var LeaseA: Code[20]; var LeaseB: Code[20]; var LeaseX: Code[20]; var TempPlanLine: Record "CGR Due Plan Line" temporary)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        DuePlan: Codeunit "CGR Lease Due Plan";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        LeaseA := CopyStr('HX089-A' + Suffix, 1, 20);
        LeaseB := CopyStr('HX089-B' + Suffix, 1, 20);
        LeaseX := CopyStr('HX089-X' + Suffix, 1, 20);
        CreateLeaseSchedule(LeaseA, 20270301D, 13, 101);
        LeaseMgt.InvoiceLine(LeaseA, 20000);
        CreateLeaseSchedule(LeaseB, 20270115D, 3, 100);
        ScheduleLine.Init();
        ScheduleLine."Contract No." := LeaseB;
        ScheduleLine."Line No." := 99999;
        ScheduleLine."Due Date" := 20270320D;
        ScheduleLine.Amount := 10;
        ScheduleLine.Insert();
        CreateLeaseSchedule(LeaseX, 20270310D, 1, 100);

        TempPlanLine.Reset();
        TempPlanLine.DeleteAll();
        TempPlanLine.Init();
        TempPlanLine."Contract No." := 'HX089-OLD';
        TempPlanLine."Due Year" := 2027;
        TempPlanLine."Due Month" := 1;
        TempPlanLine.Amount := 999;
        TempPlanLine.Lines := 9;
        TempPlanLine.Insert();

        DuePlan.FillDuePlan(StrSubstNo('%1|%2', LeaseA, LeaseB), 20270301D, 20280301D, TempPlanLine);
    end;

    local procedure CreateLeaseSchedule(LeaseNo: Code[20]; StartDate: Date; LeaseMonths: Integer; BaseRate: Decimal)
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
        Lease."Vehicle No." := 'HX089-V';
        Lease."Customer Name" := 'Due Plan Customer';
        Lease."Start Date" := StartDate;
        Lease.Months := LeaseMonths;
        Lease."Base Rate" := BaseRate;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    local procedure AssertPlanLine(var TempPlanLine: Record "CGR Due Plan Line" temporary; LeaseNo: Code[20]; DueYear: Integer; DueMonth: Integer; ExpectedAmount: Decimal; ExpectedLines: Integer)
    begin
        Assert.IsTrue(TempPlanLine.Get(LeaseNo, DueYear, DueMonth), StrSubstNo('Plan line %1 %2/%3', LeaseNo, DueYear, DueMonth));
        Assert.AreEqual(ExpectedAmount, TempPlanLine.Amount, StrSubstNo('Amount of %1 %2/%3', LeaseNo, DueYear, DueMonth));
        Assert.AreEqual(ExpectedLines, TempPlanLine.Lines, StrSubstNo('Lines of %1 %2/%3', LeaseNo, DueYear, DueMonth));
    end;
}
