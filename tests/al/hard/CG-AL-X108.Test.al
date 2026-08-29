codeunit 89302 "CG-AL-X108 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // A SingleInstance codeunit's globals do not roll back with the test
    // transaction, so every test clears both the table and the check state
    // before seeding its own scenario.

    local procedure Initialize()
    var
        ModuleReg: Record "CG X108 Module Registration";
        Gate: Codeunit "CG X108 Feature Gate";
    begin
        ModuleReg.DeleteAll();
        Gate.Invalidate();
    end;

    local procedure SeedModules(ModuleCount: Integer; UnentitledIndex: Integer)
    var
        ModuleReg: Record "CG X108 Module Registration";
        i: Integer;
    begin
        for i := 1 to ModuleCount do begin
            ModuleReg.Init();
            ModuleReg."Module Code" := CopyStr(StrSubstNo('MOD%1', Format(i)), 1, 20);
            ModuleReg."Entitled" := i <> UnentitledIndex;
            ModuleReg.Insert();
        end;
    end;

    [Test]
    procedure NotActiveConfigurationReportsNotActive()
    var
        Gate: Codeunit "CG X108 Feature Gate";
    begin
        Initialize();
        SeedModules(200, 137); // one of 200 registered modules is not entitled

        Assert.IsFalse(
            Gate.IsFeatureActive(),
            'A configuration where one registered module is not entitled must report the feature as not active');
    end;

    [Test]
    procedure ActiveConfigurationReportsActive()
    var
        Gate: Codeunit "CG X108 Feature Gate";
    begin
        Initialize();
        SeedModules(200, 0); // every one of 200 registered modules is entitled

        Assert.IsTrue(
            Gate.IsFeatureActive(),
            'A configuration where every registered module is entitled must report the feature as active');
    end;

    [Test]
    procedure RepeatedCallsAfterNotActiveStayNotActiveAndCheap()
    var
        Gate: Codeunit "CG X108 Feature Gate";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        Result: Boolean;
    begin
        Initialize();
        SeedModules(200, 137); // one of 200 registered modules is not entitled

        // Warm-up: the very first determination is allowed to be expensive
        // on any implementation, so it is not budgeted.
        Result := Gate.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must report the feature as not active');

        // SelectLatestVersion flushes the session data cache, so any read
        // still hitting the database in the window below - on any of the
        // three repeated calls - costs at least one statement. A genuinely
        // remembered answer touches the database not at all and is
        // unaffected by the flush.
        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Result := Gate.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must keep reporting the feature as not active on a later call');

        SelectLatestVersion();
        Result := Gate.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must keep reporting the feature as not active on a later call');

        SelectLatestVersion();
        Result := Gate.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must keep reporting the feature as not active on a later call');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('Three checks after the first must not re-walk the full module list: budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('Three checks after the first must not re-walk the full module list: rows budget %1, actual %2', 20, RowsDelta));
    end;

    [Test]
    procedure RepeatedCallsAfterActiveStayActiveAndCheap()
    var
        Gate: Codeunit "CG X108 Feature Gate";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        Result: Boolean;
    begin
        Initialize();
        SeedModules(200, 0); // every one of 200 registered modules is entitled

        Result := Gate.IsFeatureActive();
        Assert.IsTrue(Result, 'A configuration where every registered module is entitled must report the feature as active');

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Result := Gate.IsFeatureActive();
        Assert.IsTrue(Result, 'A configuration where every registered module is entitled must keep reporting the feature as active on a later call');

        SelectLatestVersion();
        Result := Gate.IsFeatureActive();
        Assert.IsTrue(Result, 'A configuration where every registered module is entitled must keep reporting the feature as active on a later call');

        SelectLatestVersion();
        Result := Gate.IsFeatureActive();
        Assert.IsTrue(Result, 'A configuration where every registered module is entitled must keep reporting the feature as active on a later call');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('Three checks after the first must not re-walk the full module list: budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('Three checks after the first must not re-walk the full module list: rows budget %1, actual %2', 20, RowsDelta));
    end;

    [Test]
    procedure ASeparatelyDeclaredVariableSharesTheSameNotActiveAnswerWithoutRewalking()
    var
        GateA: Codeunit "CG X108 Feature Gate";
        GateB: Codeunit "CG X108 Feature Gate";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        Result: Boolean;
    begin
        // [SCENARIO] One part of the application determines the answer
        // through its own variable of the feature gate; a second,
        // independently declared variable must be served that same
        // session answer, not repeat the full determination itself.
        Initialize();
        SeedModules(200, 137); // one of 200 registered modules is not entitled

        Result := GateA.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must report the feature as not active');

        SelectLatestVersion();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Result := GateB.IsFeatureActive();

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.IsFalse(Result, 'A separately declared variable must report the same not-active answer already determined this session');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('A separately declared variable must reuse the already-determined answer instead of re-walking the full module list: budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('A separately declared variable must reuse the already-determined answer instead of re-walking the full module list: rows budget %1, actual %2', 20, RowsDelta));
    end;

    [Test]
    procedure InvalidateForcesTheNextCallToReDetermineTheAnswer()
    var
        ModuleReg: Record "CG X108 Module Registration";
        Gate: Codeunit "CG X108 Feature Gate";
        Result: Boolean;
    begin
        Initialize();
        SeedModules(200, 137); // one of 200 registered modules is not entitled

        Result := Gate.IsFeatureActive();
        Assert.IsFalse(Result, 'A configuration where one registered module is not entitled must report the feature as not active');

        Gate.Invalidate();

        // The underlying data genuinely changes between the first
        // determination and the next one, standing in for a customer's
        // entitlement being corrected mid-session.
        ModuleReg.DeleteAll();
        SeedModules(200, 0); // every module is entitled now

        Result := Gate.IsFeatureActive();
        Assert.IsTrue(Result, 'After the check is explicitly invalidated, the next call must re-determine the answer from the current module list');
    end;
}
