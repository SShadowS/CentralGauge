codeunit 80724 "CGR Plan Span Reread Tests"
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
        DropPlan('PSR-MISSING');
        DropPlan('PSR-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSR-MISSING'), 'Unknown plan');
        Lib.CreateServicePlan('PSR-MISSING', Enum::"CGR Maintenance Strategy"::Default, 8);
        Assert.AreEqual(8, SpanCache.PlanSpanMonths('PSR-MISSING'), 'Inserted');

        Lib.CreateServicePlan('PSR-A', Enum::"CGR Maintenance Strategy"::Default, 12);
        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSR-A'), 'First value');
        ServicePlan.Get('PSR-A');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);
        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSR-A'), 'Modify with trigger');
        ServicePlan."Interval Months" := 4;
        ServicePlan.Modify();
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSR-A'), 'Modify without trigger');
        ServicePlan.Rename('PSR-NEW');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSR-A'), 'Old code after rename');
        Assert.AreEqual(4, SpanCache.PlanSpanMonths('PSR-NEW'), 'New code after rename');
        ServicePlan.Delete();
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSR-NEW'), 'Deleted');
    end;

    [Test]
    procedure RepeatLookupMovesNoCounter()
    var
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSR-REP', Enum::"CGR Maintenance Strategy"::Default, 9);
        SpanCache.PlanSpanMonths('PSR-REP');

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSR-REP');

        Assert.AreEqual(0, SessionInformation.SqlStatementsExecuted - Before, 'Repeat lookup issues no statement');
    end;

    [Test]
    procedure LookupAfterChangeReadsTheDatabase()
    var
        ServicePlan: Record "CGR Service Plan";
        Before: BigInteger;
    begin
        SpanCache.ForgetPlanSpans();
        Lib.CreateServicePlan('PSR-CHG', Enum::"CGR Maintenance Strategy"::Default, 12);
        SpanCache.PlanSpanMonths('PSR-CHG');
        ServicePlan.Get('PSR-CHG');
        ServicePlan."Interval Months" := 6;
        ServicePlan.Modify(true);

        Before := SessionInformation.SqlStatementsExecuted;
        SpanCache.PlanSpanMonths('PSR-CHG');

        Assert.IsTrue(SessionInformation.SqlStatementsExecuted - Before >= 1, 'A lookup after a change reads the database');
    end;

    local procedure DropPlan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
    end;
}
