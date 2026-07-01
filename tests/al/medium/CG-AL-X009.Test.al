codeunit 80298 "CG-AL-X009 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Doc: Record "CG X009 Doc";
    begin
        Doc.DeleteAll();
    end;

    [Test]
    procedure ReturnedComputedMatchesTableComputedValue()
    var
        Doc: Record "CG X009 Doc";
        Creator: Codeunit "CG X009 Creator";
        ExpectedComputed: Integer;
        Result: Integer;
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave a "CG X009 Doc" row behind on the shared
        // container. Wipe it, committed, before seeding.
        ClearState();
        Commit();

        // [GIVEN] the expected value is computed here using the SAME rule
        // the table itself applies to a newly-inserted row for this Base
        // value, independently of the codeunit under test.
        ExpectedComputed := 5 * 7 + 3;

        // [WHEN] the codeunit creates a doc with Code 'CGX009A' and Base 5
        Result := Creator.CreateDoc('CGX009A', 5);

        // [THEN] the value returned is the one the table actually assigned
        Assert.AreEqual(
          ExpectedComputed, Result,
          'CreateDoc must return the Computed value the table assigned to the new row');

        // [THEN] the persisted row really holds that value too -- this rules
        // out any solution that computes/guesses a return value inline
        // without ever letting the table's own logic run for the row
        Assert.IsTrue(Doc.Get('CGX009A'), 'Doc row must exist after CreateDoc');
        Assert.AreEqual(
          ExpectedComputed, Doc.Computed,
          'Persisted Computed value must match the table''s own computation');

        ClearState();
    end;

    [Test]
    procedure DifferentBaseProducesDifferentComputedValue()
    var
        Doc: Record "CG X009 Doc";
        Creator: Codeunit "CG X009 Creator";
        ExpectedComputed: Integer;
        Result: Integer;
    begin
        // [GIVEN] self-heal
        ClearState();
        Commit();

        // [GIVEN] a different Base value, so a solution that hardcodes the
        // first test's numbers cannot pass by coincidence
        ExpectedComputed := 12 * 7 + 3;

        // [WHEN]
        Result := Creator.CreateDoc('CGX009B', 12);

        // [THEN]
        Assert.AreEqual(
          ExpectedComputed, Result,
          'CreateDoc must return the Computed value the table assigned to the new row');
        Assert.IsTrue(Doc.Get('CGX009B'), 'Doc row must exist after CreateDoc');
        Assert.AreEqual(
          ExpectedComputed, Doc.Computed,
          'Persisted Computed value must match the table''s own computation');

        ClearState();
    end;
}
