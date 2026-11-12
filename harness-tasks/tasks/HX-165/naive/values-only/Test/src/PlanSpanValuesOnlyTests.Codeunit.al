codeunit 80723 "CGR Plan Span Values Tests"
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
        DropPlan('PSV-MISSING');
        DropPlan('PSV-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSV-MISSING'), 'Unknown plan');
        Lib.CreateServicePlan('PSV-MISSING', Enum::"CGR Maintenance Strategy"::Default, 8);
        Assert.AreEqual(8, SpanCache.PlanSpanMonths('PSV-MISSING'), 'Inserted');

        Lib.CreateServicePlan('PSV-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSV-A'), 'First value');
        ServicePlan.Get('PSV-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);
        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSV-A'), 'Modify with trigger');
        ServicePlan."Interval Months" := 4;
        ServicePlan.Modify();
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSV-A'), 'Modify without trigger');
        ServicePlan.Rename('PSV-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSV-A'), 'Old code after rename');
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSV-NEW'), 'New code after rename');
        ServicePlan.Delete();
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSV-NEW'), 'Deleted');
    end;

    [Test]
    procedure RepeatedLookupsAgree()
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSV-REP', Enum::"CGR Maintenance Strategy"::Default, 9);

        Assert.AreEqual(SpanCache.PlanSpanMonths('PSV-REP'), SpanCache.PlanSpanMonths('PSV-REP'), 'Two lookups agree');
    end;

    [Test]
    procedure OtherPlanKeepsItsValue()
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSV-OTH-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Lib.CreateServicePlan('PSV-OTH-B', Enum::"CGR Maintenance Strategy"::Default, 3);
        SpanCache.PlanSpanMonths('PSV-OTH-B');
        ServicePlan.Get('PSV-OTH-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);

        Assert.AreEqual(3, SpanCache.PlanSpanMonths('PSV-OTH-B'), 'Other plan value');
    end;

    local procedure DropPlan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
    end;
}
