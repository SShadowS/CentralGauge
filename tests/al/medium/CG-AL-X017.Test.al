codeunit 80306 "CG-AL-X017 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure ComputeIntoUpdatesCallerResultForFirstInput()
    var
        Calculator: Codeunit "CG X017 Calculator";
        Result: Integer;
        Success: Boolean;
    begin
        // [SCENARIO] ComputeInto delivers its computed value to the caller
        // [GIVEN] The caller's Result variable starts at a sentinel value
        Result := -999;

        // [WHEN] ComputeInto runs for Input = 5
        Success := Calculator.ComputeInto(5, Result);

        // [THEN] The call reports success
        Assert.IsTrue(Success, 'ComputeInto(5, Result) should return true');

        // [THEN] The caller's own Result variable reflects the computed
        // value, not the sentinel it started at
        Assert.AreEqual(
          34, Result, 'ComputeInto(5, Result) should update the caller''s Result to 34');
    end;

    [Test]
    procedure ComputeIntoUpdatesCallerResultForSecondInput()
    var
        Calculator: Codeunit "CG X017 Calculator";
        Result: Integer;
        Success: Boolean;
    begin
        // [SCENARIO] A different input proves the value is genuinely
        // computed, not a hardcoded constant
        // [GIVEN] The caller's Result variable starts at a sentinel value
        Result := -999;

        // [WHEN] ComputeInto runs for Input = 10
        Success := Calculator.ComputeInto(10, Result);

        // [THEN] The call reports success
        Assert.IsTrue(Success, 'ComputeInto(10, Result) should return true');

        // [THEN] The caller's own Result variable reflects the computed
        // value for THIS input -- a hardcoded constant from the first test
        // would fail here
        Assert.AreEqual(
          64, Result, 'ComputeInto(10, Result) should update the caller''s Result to 64');
    end;

    [Test]
    procedure ComputeIntoOverwritesResultOnEachCall()
    var
        Calculator: Codeunit "CG X017 Calculator";
        Result: Integer;
    begin
        // [SCENARIO] The same caller variable is genuinely overwritten on
        // every call, not just read once at some earlier point
        // [GIVEN] The caller's Result variable starts at a sentinel value
        Result := -999;

        // [WHEN] A first call computes for Input = 3
        Calculator.ComputeInto(3, Result);

        // [THEN] The variable reflects that call's computed value
        Assert.AreEqual(22, Result, 'First call should update Result to 22');

        // [WHEN] A second call reuses the same variable for a different Input
        Calculator.ComputeInto(7, Result);

        // [THEN] The variable reflects the SECOND call's computed value --
        // it must not retain the first call's value or the original sentinel
        Assert.AreEqual(
          46, Result, 'Second call should update Result to 46, not retain the first value or the sentinel');
    end;
}
