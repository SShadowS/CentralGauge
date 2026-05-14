namespace CentralGauge.TestHarness;

using System.TestTools.TestRunner;

/// <summary>
/// Headless test runner. Builds a fresh AL Test Suite, runs the requested
/// test codeunit through Test Suite Mgt., and returns a JSON summary.
/// Exposed as a codeunit web service by the install codeunit, so callers
/// hit it over SOAP without opening a UI client session.
/// </summary>
codeunit 50500 "CG WS Test Runner"
{
    procedure RunTests(ExtensionId: Text; TestCodeunitId: Integer) ResultJson: Text
    var
        ALTestSuite: Record "AL Test Suite";
        TestMethodLine: Record "Test Method Line";
        CodeunitLine: Record "Test Method Line";
        TestSuiteMgt: Codeunit "Test Suite Mgt.";
        ResultObj: JsonObject;
        CodeunitArr: JsonArray;
        CodeunitTok: JsonToken;
        SuiteName: Code[10];
        StartedAt: DateTime;
        Success: Integer;
        Fail: Integer;
        Skipped: Integer;
        NotExecuted: Integer;
    begin
        StartedAt := CurrentDateTime();

        SuiteName := 'CGWS';
        if ALTestSuite.Get(SuiteName) then
            ALTestSuite.Delete(true);
        TestSuiteMgt.CreateTestSuite(SuiteName);
        ALTestSuite.Get(SuiteName);

        if TestCodeunitId > 0 then
            TestSuiteMgt.SelectTestMethodsByRange(ALTestSuite, Format(TestCodeunitId))
        else
            TestSuiteMgt.SelectTestMethodsByExtension(ALTestSuite, ExtensionId);

        // RunAllTests / CalcTestResults read the "Test Suite" FIELD value, not the
        // filter, so a record must actually be loaded before calling them.
        TestMethodLine.SetRange("Test Suite", SuiteName);
        if not TestMethodLine.FindFirst() then begin
            ResultObj.Add('error', 'no test methods found for the given filter');
            ResultObj.WriteTo(ResultJson);
            exit;
        end;
        TestSuiteMgt.RunAllTests(TestMethodLine);

        TestMethodLine.Reset();
        TestMethodLine.SetRange("Test Suite", SuiteName);
        TestMethodLine.FindFirst();
        TestSuiteMgt.CalcTestResults(TestMethodLine, Success, Fail, Skipped, NotExecuted);

        CodeunitLine.SetRange("Test Suite", SuiteName);
        CodeunitLine.SetRange("Line Type", CodeunitLine."Line Type"::Codeunit);
        if CodeunitLine.FindSet() then
            repeat
                CodeunitTok.ReadFrom(TestSuiteMgt.TestResultsToJSON(CodeunitLine));
                CodeunitArr.Add(CodeunitTok);
            until CodeunitLine.Next() = 0;

        ResultObj.Add('passed', Success);
        ResultObj.Add('failed', Fail);
        ResultObj.Add('skipped', Skipped);
        ResultObj.Add('notExecuted', NotExecuted);
        ResultObj.Add('durationMs', CurrentDateTime() - StartedAt);
        ResultObj.Add('codeunits', CodeunitArr);
        ResultObj.WriteTo(ResultJson);
    end;
}
