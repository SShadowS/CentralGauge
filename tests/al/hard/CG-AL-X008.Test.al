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
    procedure ReturnsSumOfInputsViaBackgroundWorker()
    var
        Orchestrator: Codeunit "CG X008 Orchestrator";
        Inputs: List of [Integer];
        Result: Integer;
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave Input/Signal rows behind on the shared
        // container. Wipe them, committed, before seeding.
        ClearState();
        Commit();

        // [GIVEN] a set of inputs to be summed by the background worker
        Inputs.Add(10);
        Inputs.Add(25);
        Inputs.Add(7);

        // [WHEN] the orchestrator writes the inputs, runs the worker in the
        // background, waits for it, and returns its computed sum
        Result := Orchestrator.ComputeViaWorker(Inputs);

        // [THEN] the result is the true sum computed by the background worker
        Assert.AreEqual(
          42, Result,
          'Result must equal the sum of the inputs, as computed by the background worker');

        ClearState();
    end;
}
