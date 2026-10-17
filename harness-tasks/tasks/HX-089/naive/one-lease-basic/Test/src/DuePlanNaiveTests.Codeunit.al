codeunit 80146 "CGR Due Plan Naive A"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PlanListsOpenInstallments()
    var
        TempPlanLine: Record "CGR Due Plan Line" temporary;
        Lease: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        DuePlan: Codeunit "CGR Lease Due Plan";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        ScheduleLine.SetRange("Contract No.", 'HX089-N1');
        ScheduleLine.DeleteAll();
        if Lease.Get('HX089-N1') then
            Lease.Delete();
        Lease.Init();
        Lease."No." := 'HX089-N1';
        Lease."Start Date" := 20270301D;
        Lease.Months := 3;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule('HX089-N1');

        DuePlan.FillDuePlan('HX089-N1', 20270101D, 20271231D, TempPlanLine);

        Assert.AreEqual(3, TempPlanLine.Count(), 'One plan line per month');
        TempPlanLine.FindSet();
        repeat
            Assert.IsTrue(TempPlanLine."Due Month" in [3, 4, 5], 'Due month');
            Assert.AreEqual(103, TempPlanLine.Amount, 'Installment amount');
            Assert.AreEqual(1, TempPlanLine.Lines, 'One installment per month');
        until TempPlanLine.Next() = 0;
    end;
}
