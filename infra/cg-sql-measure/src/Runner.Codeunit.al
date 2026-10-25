using CentralGauge.TestHarness;

/// <summary>
/// Q-06: the measuring web service. Runs the harness's own runner (so the
/// results and the isolation choice are the normal ones) and returns them with
/// the measurements of the same run. One call, so one session: the in-memory
/// store survives from the run to the readout.
/// </summary>
codeunit 50561 "CG SQL Measure Runner"
{
    procedure RunTests(ExtensionId: Text; TestCodeunitId: Integer) ResultJson: Text
    var
        Store: Codeunit "CG SQL Measure Store";
        Harness: Codeunit "CG WS Test Runner";
        Results: JsonObject;
        Measurements: JsonArray;
        Output: JsonObject;
    begin
        Store.ClearEntries();
        // The harness JSON goes through unchanged, as an object.
        Results.ReadFrom(Harness.RunTests(ExtensionId, TestCodeunitId));
        Measurements.ReadFrom(Store.GetJson());
        Output.Add('results', Results);
        Output.Add('measurements', Measurements);
        Output.WriteTo(ResultJson);
    end;
}
