using CentralGauge.TestHarness;

/// <summary>
/// Q-06: the measuring web service. Runs the harness's own runner (so the
/// results and the isolation choice are the normal ones) and returns them with
/// the measurements of the same run. One call, so one session: the in-memory
/// store survives from the run to the readout.
/// The store records only while this call has it switched on: on before the
/// harness run, off after it, also when the run fails (the run goes through
/// Codeunit.Run, so an error comes back as false, the store is switched off,
/// and the error is raised again).
/// </summary>
codeunit 50561 "CG SQL Measure Runner"
{
    procedure RunTests(ExtensionId: Text; TestCodeunitId: Integer) ResultJson: Text
    var
        Store: Codeunit "CG SQL Measure Store";
        HarnessRun: Codeunit "CG SQL Measure Harness Run";
        Results: JsonObject;
        Measurements: JsonArray;
        Output: JsonObject;
        Ok: Boolean;
    begin
        Store.ClearEntries();
        HarnessRun.SetArgs(ExtensionId, TestCodeunitId);
        ClearLastError();
        Store.SetActive(true);
        Ok := HarnessRun.Run();
        Store.SetActive(false);
        if not Ok then
            Error(GetLastErrorText());
        // The harness JSON goes through unchanged, as an object.
        Results.ReadFrom(HarnessRun.GetResult());
        Measurements.ReadFrom(Store.GetJson());
        Output.Add('results', Results);
        Output.Add('measurements', Measurements);
        Output.WriteTo(ResultJson);
    end;
}
