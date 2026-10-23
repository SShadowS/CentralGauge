namespace CentralGauge.TestHarness;

using System.TestTools.TestRunner;
using System.Reflection;
using System.Environment.Configuration;

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
        CodeunitMetadata: Record "CodeUnit Metadata";
        TestSuiteMgt: Codeunit "Test Suite Mgt.";
        TestRunnerMgt: Codeunit "Test Runner - Mgt";
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

        // A test codeunit that declares `RequiredTestIsolation = Disabled;`
        // (e.g. a background-session/StartSession trap task) cannot run under
        // the default "Test Runner - Isol. Codeunit" (130450): the platform
        // throws "Sessions can only be started in tests that are run by a
        // TestRunner that has TestIsolation set to Disabled." Switch this
        // suite's runner to "Test Runner - Isol. Disabled" (130451) whenever
        // the requested test codeunit asks for it. Every other test codeunit
        // (RequiredTestIsolation defaults to Codeunit) is unaffected.
        if (TestCodeunitId > 0) and CodeunitMetadata.Get(TestCodeunitId) then
            if CodeunitMetadata.RequiredTestIsolation = CodeunitMetadata.RequiredTestIsolation::Disabled then
                TestSuiteMgt.ChangeTestRunner(ALTestSuite, TestRunnerMgt.GetIsolationDisabledTestRunner());

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

    /// <summary>
    /// H-35 S3 L2a (design-r5 2.2): set "Allow HttpClient Requests" for one
    /// extension and read it back from the table. Returns 'allow=true' or
    /// 'allow=false' as stored after the write; the caller compares.
    /// </summary>
    procedure SetHttpClientAllowed(AppId: Text; Allowed: Boolean) Result: Text
    var
        NAVAppSetting: Record "NAV App Setting";
        Id: Guid;
    begin
        Evaluate(Id, AppId);
        if NAVAppSetting.Get(Id) then begin
            NAVAppSetting."Allow HttpClient Requests" := Allowed;
            NAVAppSetting.Modify();
        end else begin
            NAVAppSetting.Init();
            NAVAppSetting."App ID" := Id;
            NAVAppSetting."Allow HttpClient Requests" := Allowed;
            NAVAppSetting.Insert();
        end;
        Clear(NAVAppSetting);
        NAVAppSetting.Get(Id);
        if NAVAppSetting."Allow HttpClient Requests" then
            exit('allow=true');
        exit('allow=false');
    end;
}
