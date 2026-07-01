codeunit 80297 "CG-AL-X008 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    RequiredTestIsolation = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Input: Record "CG X008 Input";
        Signal: Record "CG X008 Signal";
    begin
        Input.DeleteAll();
        if Signal.Get('') then
            Signal.Delete();
    end;

    [Test]
    procedure ReturnsWorkerComputedValueViaBackgroundSession()
    var
        Orchestrator: Codeunit "CG X008 Orchestrator";
        Signal: Record "CG X008 Signal";
        Inputs: List of [Integer];
        InputValue: Integer;
        Total: Integer;
        ExpectedResult: Integer;
        Result: Integer;
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave Input/Signal rows behind on the shared
        // container. Wipe them, committed, before seeding.
        ClearState();
        Commit();

        // [GIVEN] a set of inputs to be processed by the background worker.
        // The expected value is computed here using the SAME formula the
        // worker itself applies (sum * 3 + row count), independently of the
        // orchestrator under test, so a correct result can only come from a
        // real worker run over these committed rows - not a guess.
        Inputs.Add(10);
        Inputs.Add(25);
        Inputs.Add(7);

        Total := 0;
        foreach InputValue in Inputs do
            Total += InputValue;
        ExpectedResult := Total * 3 + Inputs.Count();

        // [WHEN] the orchestrator writes the inputs, runs the worker in the
        // background, waits for it, and returns the value it computed
        Result := Orchestrator.ComputeViaWorker(Inputs);

        // [THEN] the returned value matches what the background worker
        // actually computed
        Assert.AreEqual(
          ExpectedResult, Result,
          'Result must equal the value computed by the background worker');

        // [THEN] the worker really ran and committed its own state: the
        // Signal row exists, is marked Done, and holds the same value. This
        // rules out any solution that never writes/commits/StartSessions the
        // worker and merely returns a guessed number.
        Assert.IsTrue(Signal.Get(''), 'Signal row must exist after the background worker ran');
        Assert.IsTrue(Signal.Done, 'Signal.Done must be true after the background worker ran');
        Assert.AreEqual(
          ExpectedResult, Signal.Result,
          'Signal.Result must equal the value the worker computed and stored');

        ClearState();
    end;
}
