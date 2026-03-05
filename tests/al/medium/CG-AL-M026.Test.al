codeunit 80026 "CG-AL-M026 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        CallstackInspector: Codeunit "CG Callstack Inspector";

    [Test]
    procedure TestGetCurrentCallstack_NotEmpty()
    var
        Result: Text;
    begin
        // [SCENARIO] GetCurrentCallstack returns non-empty callstack
        // [WHEN] Getting current callstack
        Result := CallstackInspector.GetCurrentCallstack();

        // [THEN] Result is not empty
        Assert.AreNotEqual('', Result, 'Callstack should not be empty');
    end;

    [Test]
    procedure TestGetCurrentCallstack_ContainsProcedureName()
    var
        Result: Text;
    begin
        // [SCENARIO] Callstack contains the procedure that captured it
        // [WHEN] Getting current callstack
        Result := CallstackInspector.GetCurrentCallstack();

        // [THEN] Contains GetCurrentCallstack procedure name
        Assert.IsTrue(Result.Contains('GetCurrentCallstack'), 'Callstack should contain GetCurrentCallstack');
    end;

    [Test]
    procedure TestGetCallstackFromNested_NotEmpty()
    var
        Result: Text;
    begin
        // [SCENARIO] Nested callstack returns non-empty result
        // [WHEN] Getting callstack from nested call
        Result := CallstackInspector.GetCallstackFromNested();

        // [THEN] Result is not empty
        Assert.AreNotEqual('', Result, 'Nested callstack should not be empty');
    end;

    [Test]
    procedure TestGetCallstackFromNested_ContainsNestedProcedures()
    var
        Result: Text;
    begin
        // [SCENARIO] Nested callstack contains inner procedure names
        // [WHEN] Getting callstack from nested call
        Result := CallstackInspector.GetCallstackFromNested();

        // [THEN] Contains nested procedure names
        Assert.IsTrue(Result.Contains('DeepProcedure') or Result.Contains('InnerProcedure'),
            'Callstack should contain nested procedure names');
    end;

    [Test]
    procedure TestGetCallstackLineCount_AtLeastOne()
    var
        LineCount: Integer;
    begin
        // [SCENARIO] Callstack has at least 1 line
        // [WHEN] Getting line count
        LineCount := CallstackInspector.GetCallstackLineCount();

        // [THEN] At least 1 line
        Assert.IsTrue(LineCount >= 1, 'Callstack should have at least 1 line');
    end;

    [Test]
    procedure TestGetCallstackLineCount_Positive()
    var
        LineCount: Integer;
    begin
        // [SCENARIO] Callstack line count is positive
        // [WHEN] Getting line count
        LineCount := CallstackInspector.GetCallstackLineCount();

        // [THEN] Positive count
        Assert.IsTrue(LineCount > 0, 'Line count should be positive');
    end;

    [Test]
    procedure TestCallstackContainsProcedure_Positive()
    var
        Result: Boolean;
    begin
        // [SCENARIO] CallstackContainsProcedure finds existing procedure
        // [WHEN] Checking for CallstackContainsProcedure itself
        Result := CallstackInspector.CallstackContainsProcedure('CallstackContainsProcedure');

        // [THEN] Returns true
        Assert.IsTrue(Result, 'Should find CallstackContainsProcedure in callstack');
    end;

    [Test]
    procedure TestCallstackContainsProcedure_Negative()
    var
        Result: Boolean;
    begin
        // [SCENARIO] CallstackContainsProcedure returns false for non-existent procedure
        // [WHEN] Checking for non-existent procedure
        Result := CallstackInspector.CallstackContainsProcedure('NonExistentProcedureXYZ');

        // [THEN] Returns false
        Assert.IsFalse(Result, 'Should not find non-existent procedure in callstack');
    end;
}
