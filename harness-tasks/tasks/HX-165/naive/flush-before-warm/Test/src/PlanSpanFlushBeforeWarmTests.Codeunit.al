codeunit 80722 "CGR Plan Span Warm Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SpanCache: Codeunit "CGR Plan Span Cache";

    [Test]
    procedure ChangesAreSeenByNextLookup()
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        SpanCache.ForgetPlanSpans();
        DropPlan('PSW-MISSING');
        DropPlan('PSW-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSW-MISSING'), 'Unknown plan');
        Lib.CreateServicePlan('PSW-MISSING', Enum::"CGR Maintenance Strategy"::Default, 8);
        Assert.AreEqual(8, SpanCache.PlanSpanMonths('PSW-MISSING'), 'Inserted');

        Lib.CreateServicePlan('PSW-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSW-A'), 'First value');
        ServicePlan.Get('PSW-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);
        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSW-A'), 'Modify with trigger');
        ServicePlan."Interval Months" := 4;
        ServicePlan.Modify();
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSW-A'), 'Modify without trigger');
        ServicePlan.Rename('PSW-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSW-A'), 'Old code after rename');
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSW-NEW'), 'New code after rename');
        ServicePlan.Delete();
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSW-NEW'), 'Deleted');
    end;

    [Test]
    procedure RepeatLookupAfterFlushMovesNoCounter()
    var
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Commit();
        SelectLatestVersion();
        Lib.CreateServicePlan('PSW-REP', Enum::"CGR Maintenance Strategy"::Default, 9);
        SpanCache.PlanSpanMonths('PSW-REP');

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSW-REP');

        Assert.IsTrue(SessionInformation.SqlStatementsExecuted - Before = 0, 'Repeat lookup issues no statement');
    end;

    [Test]
    procedure OtherPlanMovesNoCounter()
    var
        ServicePlan: Record "CGR Service Plan";
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Commit();
        SelectLatestVersion();
        Lib.CreateServicePlan('PSW-OTH-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Lib.CreateServicePlan('PSW-OTH-B', Enum::"CGR Maintenance Strategy"::Default, 3);
        SpanCache.PlanSpanMonths('PSW-OTH-A');
        SpanCache.PlanSpanMonths('PSW-OTH-B');
        ServicePlan.Get('PSW-OTH-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSW-OTH-B');

        Assert.IsTrue(SessionInformation.SqlStatementsExecuted - Before = 0, 'Other plan issues no statement');
    end;

    local procedure DropPlan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
    end;
}
