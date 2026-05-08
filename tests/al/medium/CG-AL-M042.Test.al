codeunit 80100 "CG-AL-M042 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestShiftMinUpPreservesWidth()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] Validating Range Min upward shifts Range Max by the same delta.
        ObjectRange.Init();
        ObjectRange.Code := 'A';
        ObjectRange."Range Min" := 100;
        ObjectRange."Range Max" := 200;
        ObjectRange.Insert();

        ObjectRange.Get('A');
        ObjectRange.Validate("Range Min", 150);
        Assert.AreEqual(150, ObjectRange."Range Min", 'Range Min must reflect the validated value');
        Assert.AreEqual(250, ObjectRange."Range Max", 'Range Max must shift up by the same delta to keep width = 100');
    end;

    [Test]
    procedure TestShiftMinDownPreservesWidth()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] Validating Range Min downward shifts Range Max by the same delta.
        ObjectRange.Init();
        ObjectRange.Code := 'B';
        ObjectRange."Range Min" := 100;
        ObjectRange."Range Max" := 200;
        ObjectRange.Insert();

        ObjectRange.Get('B');
        ObjectRange.Validate("Range Min", 50);
        Assert.AreEqual(50, ObjectRange."Range Min", 'Range Min must reflect the validated value');
        Assert.AreEqual(150, ObjectRange."Range Max", 'Range Max must shift down by the same delta to keep width = 100');
    end;

    [Test]
    procedure TestShiftMinByOnePreservesWidth()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] A unit shift of Range Min must move Range Max by exactly one.
        ObjectRange.Init();
        ObjectRange.Code := 'C';
        ObjectRange."Range Min" := 1000;
        ObjectRange."Range Max" := 1042;
        ObjectRange.Insert();

        ObjectRange.Get('C');
        ObjectRange.Validate("Range Min", 1001);
        Assert.AreEqual(1001, ObjectRange."Range Min", 'Range Min must reflect the validated value');
        Assert.AreEqual(1043, ObjectRange."Range Max", 'Range Max must follow Range Min by 1 to keep width = 42');
    end;

    [Test]
    procedure TestShiftMinByLargeDeltaPreservesWidth()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] A large shift of Range Min must scale Range Max by the same delta.
        ObjectRange.Init();
        ObjectRange.Code := 'D';
        ObjectRange."Range Min" := 50000;
        ObjectRange."Range Max" := 50099;
        ObjectRange.Insert();

        ObjectRange.Get('D');
        ObjectRange.Validate("Range Min", 70000);
        Assert.AreEqual(70000, ObjectRange."Range Min", 'Range Min must reflect the validated value');
        Assert.AreEqual(70099, ObjectRange."Range Max", 'Range Max must shift by 20000 to keep width = 99');
    end;

    [Test]
    procedure TestValidateMaxDoesNotAffectMin()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] Validating Range Max must accept the value without touching Range Min.
        ObjectRange.Init();
        ObjectRange.Code := 'E';
        ObjectRange."Range Min" := 100;
        ObjectRange."Range Max" := 200;
        ObjectRange.Insert();

        ObjectRange.Get('E');
        ObjectRange.Validate("Range Max", 999);
        Assert.AreEqual(100, ObjectRange."Range Min", 'Validating Range Max must NOT change Range Min');
        Assert.AreEqual(999, ObjectRange."Range Max", 'Range Max must reflect the validated value as-is');
    end;

    [Test]
    procedure TestSequentialMinValidationsCompound()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] Two successive Validate calls on Range Min each preserve the width
        // computed from the record state at the time of that call.
        ObjectRange.Init();
        ObjectRange.Code := 'F';
        ObjectRange."Range Min" := 100;
        ObjectRange."Range Max" := 200;
        ObjectRange.Insert();

        ObjectRange.Get('F');
        ObjectRange.Validate("Range Min", 150);
        Assert.AreEqual(250, ObjectRange."Range Max", 'After first shift width must remain 100');
        Assert.AreEqual(100, ObjectRange."Range Max" - ObjectRange."Range Min", 'Width must equal 100 after first shift');

        ObjectRange.Validate("Range Min", 175);
        Assert.AreEqual(275, ObjectRange."Range Max", 'After second shift Range Max must follow Range Min keeping width = 100');
        Assert.AreEqual(100, ObjectRange."Range Max" - ObjectRange."Range Min", 'Width must remain 100 after second shift');
    end;

    [Test]
    procedure TestGetRangeWidthReturnsDifference()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] GetRangeWidth must return Range Max - Range Min.
        ObjectRange.Init();
        ObjectRange.Code := 'G';
        ObjectRange."Range Min" := 10;
        ObjectRange."Range Max" := 60;
        ObjectRange.Insert();

        ObjectRange.Get('G');
        Assert.AreEqual(50, ObjectRange.GetRangeWidth(), 'GetRangeWidth must equal Range Max - Range Min');
    end;

    [Test]
    procedure TestGetRangeWidthAllowsNegative()
    var
        ObjectRange: Record "CG M042 Object Range";
    begin
        // [SCENARIO] GetRangeWidth must return the raw difference even when negative.
        ObjectRange.Init();
        ObjectRange.Code := 'H';
        ObjectRange."Range Min" := 100;
        ObjectRange."Range Max" := 40;
        ObjectRange.Insert();

        ObjectRange.Get('H');
        Assert.AreEqual(-60, ObjectRange.GetRangeWidth(), 'GetRangeWidth must return negative differences as-is');
    end;
}
