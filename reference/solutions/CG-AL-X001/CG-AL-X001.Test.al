codeunit 80290 "CG-AL-X001 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearCounter()
    var
        Counter: Record "CG X001 Counter";
    begin
        Counter.DeleteAll();
        Commit();
    end;

    local procedure ReadCount(): Integer
    var
        Counter: Record "CG X001 Counter";
    begin
        if Counter.Get('') then
            exit(Counter."Count");
        exit(0);
    end;

    [Test]
    procedure SubscriberObservesEventWhenBound()
    var
        Worker: Codeunit "CG X001 Worker";
    begin
        // [GIVEN] A clean counter
        ClearCounter();

        // [WHEN] The worker runs its audited procedure
        Worker.RunAudited();

        // [THEN] The manual audit subscriber observed exactly one event
        Assert.AreEqual(
          1, ReadCount(),
          'The manual subscriber must observe the event raised during RunAudited');
    end;

    [Test]
    procedure ManualSubscriberSilentWhenUnbound()
    var
        Publisher: Codeunit "CG X001 Publisher";
    begin
        // [GIVEN] A clean counter, no Worker involved, nothing bound
        ClearCounter();

        // [WHEN] The event is raised directly with no subscription active
        Publisher.Raise();

        // [THEN] The manual subscriber stays silent (control: proves it is
        // genuinely manual, not auto-wired)
        Assert.AreEqual(
          0, ReadCount(),
          'The manual subscriber must not fire when nothing bound it');
    end;
}
