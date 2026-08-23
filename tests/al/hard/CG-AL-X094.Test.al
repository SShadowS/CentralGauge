codeunit 89091 "CG-AL-X094 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // Consume the return value of Bind/UnbindSubscription rather than calling
    // the bare statement form (X062 lesson).
    local procedure Activate(var OtherRule: Codeunit "CG-AL-X094 Other Rule")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(OtherRule);
    end;

    local procedure Deactivate(var OtherRule: Codeunit "CG-AL-X094 Other Rule")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(OtherRule);
    end;

    [Test]
    procedure CustomPathIncludesMandatorySegment()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0001', 5);

        Assert.AreEqual('CUST~S0001/FY05', Result, 'A reference resolved through the custom rule must carry its mandatory segment, same as any other reference');
    end;

    [Test]
    procedure CustomPathMandatorySegmentReflectsItsOwnPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0002', 47);

        Assert.AreEqual('CUST~S0002/FY47', Result, 'The mandatory segment on a custom-resolved reference must reflect that reference''s own period, not a fixed value');
    end;

    [Test]
    procedure CustomPathBodyIsStillTheCustomBody()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0001', 5);

        Assert.IsTrue(StrPos(Result, 'CUST~S0001') = 1, 'A category CUSTOM reference must still show the custom rule''s resolved body');
    end;

    [Test]
    procedure DefaultPathIncludesMandatorySegment()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('STD', 'S0001', 5);

        Assert.AreEqual('STD-S0001/FY05', Result, 'A reference resolved through the default rule must carry its mandatory segment');
    end;

    [Test]
    procedure DefaultPathMandatorySegmentReflectsItsOwnPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('STD', 'S0002', 47);

        Assert.AreEqual('STD-S0002/FY47', Result, 'The mandatory segment on a default-resolved reference must reflect that reference''s own period, not a fixed value');
    end;

    [Test]
    procedure MandatorySegmentReflectsEachDistinctPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
    begin
        Assert.AreEqual('FY05', Engine.FiscalSegmentFor(5), 'Period 5 must produce its own mandatory segment');
        Assert.AreEqual('FY47', Engine.FiscalSegmentFor(47), 'Period 47 must produce its own mandatory segment');
        Assert.AreEqual('FY00', Engine.FiscalSegmentFor(100), 'Period 100 must wrap to the segment for period 0, not stay fixed');
        Assert.AreEqual('FY97', Engine.FiscalSegmentFor(-3), 'A negative period must wrap into the same segment space');
    end;

    [Test]
    procedure AThirdRuleStillProducesItsOwnBody()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        OtherRule: Codeunit "CG-AL-X094 Other Rule";
        Result: Text[50];
    begin
        Activate(OtherRule);
        Result := Engine.ResolveReference('ZOTHER', 'S0003', 5);
        Deactivate(OtherRule);

        Assert.IsTrue(StrPos(Result, 'ZZZ') = 1, 'A reference resolved by another custom rule must still show that rule''s own body');
    end;
}
