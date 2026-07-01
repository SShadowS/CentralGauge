codeunit 80319 "CG-AL-X030 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure DeadlineUsesRealCurrentDateNotBackdatedSession()
    var
        DeadlineCalc: Codeunit "CG X030 Deadline Calc";
        OrigWorkDate: Date;
        Actual: Date;
        Expected: Date;
        LeadTimeDays: Integer;
    begin
        // [GIVEN] The session's adjustable work date is set 100 days behind
        // the real calendar date.
        OrigWorkDate := WorkDate();
        WorkDate(Today() - 100);
        LeadTimeDays := 7;

        // [WHEN] ComputeDeadline is asked for a deadline LeadTimeDays out.
        Actual := DeadlineCalc.ComputeDeadline(LeadTimeDays);

        // Restore the session's adjustable work date immediately after the
        // call under test, before asserting, so a failing assertion below
        // still leaves the shared container's session state clean for
        // whichever test runs next.
        WorkDate(OrigWorkDate);

        // [THEN] The deadline is based on the real calendar date, not the
        // backdated session value.
        Expected := Today() + LeadTimeDays;
        Assert.AreEqual(
            Expected, Actual,
            'Deadline should be based on the real current date, not the adjustable session date');
    end;

    [Test]
    procedure DeadlineUsesRealCurrentDateWithDifferentOffset()
    var
        DeadlineCalc: Codeunit "CG X030 Deadline Calc";
        OrigWorkDate: Date;
        Actual: Date;
        Expected: Date;
        LeadTimeDays: Integer;
    begin
        // [GIVEN] A different backdate amount and a different lead time than
        // the first test, so a value that coincidentally matches on one case
        // cannot carry a wrong implementation through both.
        OrigWorkDate := WorkDate();
        WorkDate(Today() - 250);
        LeadTimeDays := 30;

        // [WHEN] ComputeDeadline is asked for a deadline LeadTimeDays out.
        Actual := DeadlineCalc.ComputeDeadline(LeadTimeDays);

        // Restore before asserting - see note in the first test.
        WorkDate(OrigWorkDate);

        // [THEN] The deadline is based on the real calendar date, not the
        // backdated session value.
        Expected := Today() + LeadTimeDays;
        Assert.AreEqual(
            Expected, Actual,
            'Deadline should be based on the real current date, not the adjustable session date');
    end;
}
