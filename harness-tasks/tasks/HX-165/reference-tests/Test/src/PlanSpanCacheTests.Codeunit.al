codeunit 80720 "CGR Plan Span Cache Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SpanCache: Codeunit "CGR Plan Span Cache";

    [Test]
    procedure LookupReturnsIntervalOfEachPlan()
    begin
        Reset();
        CreatePlan('PSC-VAL-A', 12);
        CreatePlan('PSC-VAL-B', 7);

        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSC-VAL-A'), 'Interval of plan A');
        Assert.AreEqual(7, SpanCache.PlanSpanMonths('PSC-VAL-B'), 'Interval of plan B');
    end;

    [Test]
    procedure UnknownPlanAnswersZero()
    begin
        Reset();
        DropPlan('PSC-NONE');

        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSC-NONE'), 'A plan that does not exist answers 0');
    end;

    [Test]
    procedure RepeatLookupIssuesNoStatement()
    var
        Months: Integer;
    begin
        Reset();
        CreatePlan('PSC-REP', 9);
        SpanCache.PlanSpanMonths('PSC-REP');
        CommitAndDropServerReads();

        Assert.AreEqual(0, StatementsOfLookup('PSC-REP', Months), 'A repeat lookup is answered from memory');
        Assert.AreEqual(9, Months, 'Repeat lookup value');
    end;

    [Test]
    procedure ChangeWithTriggerIsSeen()
    begin
        Reset();
        CreatePlan('PSC-MOD-T', 12);
        SpanCache.PlanSpanMonths('PSC-MOD-T');

        SetMonths('PSC-MOD-T', 6, true);

        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSC-MOD-T'), 'Change through Modify(true) is seen');
    end;

    [Test]
    procedure ChangeWithoutTriggerIsSeen()
    begin
        Reset();
        CreatePlan('PSC-MOD-N', 12);
        SpanCache.PlanSpanMonths('PSC-MOD-N');

        SetMonths('PSC-MOD-N', 6, false);

        Assert.AreEqual(6, SpanCache.PlanSpanMonths('PSC-MOD-N'), 'Change without table triggers is seen');
    end;

    [Test]
    procedure DeletedPlanAnswersZero()
    begin
        Reset();
        CreatePlan('PSC-DEL', 12);
        SpanCache.PlanSpanMonths('PSC-DEL');

        DropPlan('PSC-DEL');

        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSC-DEL'), 'A deleted plan answers 0');
    end;

    [Test]
    procedure RenamedPlanMovesToNewCode()
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        Reset();
        DropPlan('PSC-REN-NEW');
        CreatePlan('PSC-REN-OLD', 12);
        SpanCache.PlanSpanMonths('PSC-REN-OLD');

        ServicePlan.Get('PSC-REN-OLD');
        ServicePlan.Rename('PSC-REN-NEW');

        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSC-REN-OLD'), 'The old code answers 0 after a rename');
        Assert.AreEqual(12, SpanCache.PlanSpanMonths('PSC-REN-NEW'), 'The new code answers the interval');
    end;

    [Test]
    procedure InsertedPlanIsSeenAfterZeroAnswer()
    begin
        Reset();
        DropPlan('PSC-INS');
        Assert.AreEqual(0, SpanCache.PlanSpanMonths('PSC-INS'), 'Not there yet');

        CreatePlan('PSC-INS', 8);

        Assert.AreEqual(8, SpanCache.PlanSpanMonths('PSC-INS'), 'A plan inserted after a 0 answer is seen');
    end;

    [Test]
    procedure ChangeLeavesOtherPlanInMemory()
    var
        Months: Integer;
    begin
        Reset();
        CreatePlan('PSC-OTH-A', 12);
        CreatePlan('PSC-OTH-B', 3);
        SpanCache.PlanSpanMonths('PSC-OTH-A');
        SpanCache.PlanSpanMonths('PSC-OTH-B');

        SetMonths('PSC-OTH-A', 6, true);
        CommitAndDropServerReads();

        Assert.AreEqual(0, StatementsOfLookup('PSC-OTH-B', Months), 'A change to plan A leaves plan B in memory');
        Assert.AreEqual(3, Months, 'Plan B value');
    end;

    [Test]
    procedure ForgetEmptiesMemory()
    var
        Months: Integer;
    begin
        Reset();
        CreatePlan('PSC-FGT', 5);
        SpanCache.PlanSpanMonths('PSC-FGT');
        CommitAndDropServerReads();

        SpanCache.ForgetPlanSpans();

        Assert.IsTrue(StatementsOfLookup('PSC-FGT', Months) > 0, 'After ForgetPlanSpans the lookup reads the database');
        Assert.AreEqual(5, Months, 'Value after forget');
    end;

    local procedure Reset()
    begin
        SpanCache.ForgetPlanSpans();
    end;

    local procedure CreatePlan(PlanCode: Code[20]; IntervalMonths: Integer)
    begin
        Lib.CreateServicePlan(PlanCode, Enum::"CGR Maintenance Strategy"::Default, IntervalMonths);
    end;

    local procedure DropPlan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
    end;

    local procedure SetMonths(PlanCode: Code[20]; IntervalMonths: Integer; RunTrigger: Boolean)
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        ServicePlan.Get(PlanCode);
        ServicePlan."Interval Months" := IntervalMonths;
        ServicePlan.Modify(RunTrigger);
    end;

    local procedure CommitAndDropServerReads()
    begin
        Commit();
        SelectLatestVersion();
    end;

    local procedure StatementsOfLookup(PlanCode: Code[20]; var Months: Integer): BigInteger
    var
        Before: BigInteger;
    begin
        Before := SessionInformation.SqlStatementsExecuted;
        Months := SpanCache.PlanSpanMonths(PlanCode);
        exit(SessionInformation.SqlStatementsExecuted - Before);
    end;
}
