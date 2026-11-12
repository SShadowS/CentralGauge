codeunit 80721 "CGR Plan Span Delta Tests"
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
        DropPlan('PSD-MISSING');
        DropPlan('PSD-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSD-MISSING'), 'Unknown plan');
        Lib.CreateServicePlan('PSD-MISSING', Enum::"CGR Maintenance Strategy"::Default, 8);
        Assert.AreEqual(8, SpanCache.PlanSpanMonths('PSD-MISSING'), 'Inserted');

        Lib.CreateServicePlan('PSD-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSD-A'), 'First value');
        ServicePlan.Get('PSD-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);
        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSD-A'), 'Modify with trigger');
        ServicePlan."Interval Months" := 4;
        ServicePlan.Modify();
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSD-A'), 'Modify without trigger');
        ServicePlan.Rename('PSD-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSD-A'), 'Old code after rename');
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSD-NEW'), 'New code after rename');
        ServicePlan.Delete();
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSD-NEW'), 'Deleted');
    end;

    [Test]
    procedure RepeatLookupMovesNoCounter()
    var
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSD-REP', Enum::"CGR Maintenance Strategy"::Default, 9);
        SpanCache.PlanSpanMonths('PSD-REP');

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSD-REP');

        Assert.IsTrue(SessionInformation.SqlStatementsExecuted - Before = 0, 'Repeat lookup issues no statement');
    end;

    [Test]
    procedure OtherPlanMovesNoCounter()
    var
        ServicePlan: Record "CGR Service Plan";
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSD-OTH-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Lib.CreateServicePlan('PSD-OTH-B', Enum::"CGR Maintenance Strategy"::Default, 3);
        SpanCache.PlanSpanMonths('PSD-OTH-A');
        SpanCache.PlanSpanMonths('PSD-OTH-B');
        ServicePlan.Get('PSD-OTH-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSD-OTH-B');

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
