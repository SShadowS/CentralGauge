using CentralGauge.TestHarness;

/// <summary>
/// Q-06: one CG WS Test Runner.RunTests call behind Codeunit.Run, so the
/// measuring runner gets control back on an error and can switch the store off.
/// </summary>
codeunit 50563 "CG SQL Measure Harness Run"
{
    var
        RunExtensionId: Text;
        RunTestCodeunitId: Integer;
        RunResult: Text;

    trigger OnRun()
    var
        Harness: Codeunit "CG WS Test Runner";
    begin
        RunResult := Harness.RunTests(RunExtensionId, RunTestCodeunitId);
    end;

    procedure SetArgs(ExtensionId: Text; TestCodeunitId: Integer)
    begin
        RunExtensionId := ExtensionId;
        RunTestCodeunitId := TestCodeunitId;
        RunResult := '';
    end;

    procedure GetResult(): Text
    begin
        exit(RunResult);
    end;
}
