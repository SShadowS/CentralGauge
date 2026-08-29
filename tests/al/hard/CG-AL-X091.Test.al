codeunit 89088 "CG-AL-X091 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // A session-scoped cache does not roll back with the test transaction,
    // so every test clears both the table and the cache before seeding its
    // own data.

    local procedure Initialize()
    var
        Setup: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Setup.DeleteAll();
        SetupMgt.Invalidate();
    end;

    local procedure SeedSetup(RouteCode: Code[20]; MaxWeight: Decimal)
    var
        Setup: Record "CG X091 Setup";
    begin
        Setup.Init();
        Setup."Primary Key" := '';
        Setup."Default Route Code" := RouteCode;
        Setup."Max Batch Weight" := MaxWeight;
        Setup.Insert();
    end;

    local procedure UpdateStoredSetup(RouteCode: Code[20]; MaxWeight: Decimal)
    var
        Setup: Record "CG X091 Setup";
    begin
        Setup.Get('');
        Setup."Default Route Code" := RouteCode;
        Setup."Max Batch Weight" := MaxWeight;
        Setup.Modify();
    end;

    [Test]
    procedure FirstCallCreatesTheMissingRow()
    var
        Setup: Record "CG X091 Setup";
        Stored: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Initialize();

        SetupMgt.GetSetup(Setup);

        Assert.IsTrue(Stored.Get(''),
            'Expected the first call to insert the setup row with the empty primary key - the row must really live in the table, not just in memory');
        Assert.RecordCount(Stored, 1);
        Assert.AreEqual('', Format(Setup."Default Route Code"),
            'Expected the auto-created row to come back with the default (empty) route code');
        Assert.AreEqual(0.0, Setup."Max Batch Weight",
            'Expected the auto-created row to come back with the default (zero) maximum batch weight');
    end;

    [Test]
    procedure ReturnsTheValuesStoredInTheTable()
    var
        Setup: Record "CG X091 Setup";
        Stored: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Initialize();
        SeedSetup('ROUTE-A', 120.5);

        SetupMgt.GetSetup(Setup);

        Assert.AreEqual('ROUTE-A', Setup."Default Route Code",
            'Expected the stored route code to be returned as-is');
        Assert.AreEqual(120.5, Setup."Max Batch Weight",
            'Expected the stored maximum batch weight to be returned as-is');
        Assert.RecordCount(Stored, 1);
        Stored.Get('');
        Assert.AreEqual('ROUTE-A', Stored."Default Route Code",
            'Expected an existing row to be left untouched - auto-create must fire only when the row is missing');
    end;

    [Test]
    procedure ChangeWrittenDirectlyToTheTableStaysHiddenUntilInvalidated()
    var
        Setup: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Initialize();
        SeedSetup('OLD-ROUTE', 50);
        SetupMgt.GetSetup(Setup);
        UpdateStoredSetup('NEW-ROUTE', 900);

        SetupMgt.GetSetup(Setup);

        Assert.AreEqual('OLD-ROUTE', Setup."Default Route Code",
            'Expected a route code changed straight in the table to stay invisible until Invalidate is called');
        Assert.AreEqual(50, Setup."Max Batch Weight",
            'Expected a weight changed straight in the table to stay invisible until Invalidate is called');
    end;

    [Test]
    procedure InvalidateMakesTheNextCallReadTheTableAgain()
    var
        Setup: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Initialize();
        SeedSetup('OLD-ROUTE', 50);
        SetupMgt.GetSetup(Setup);
        UpdateStoredSetup('NEW-ROUTE', 900);
        SetupMgt.Invalidate();

        SetupMgt.GetSetup(Setup);

        Assert.AreEqual('NEW-ROUTE', Setup."Default Route Code",
            'Expected Invalidate to make the next call read the current route code from the table');
        Assert.AreEqual(900, Setup."Max Batch Weight",
            'Expected Invalidate to make the next call read the current weight from the table');
    end;

    [Test]
    procedure InvalidateThenDeletedRowIsRecreated()
    var
        Setup: Record "CG X091 Setup";
        Stored: Record "CG X091 Setup";
        SetupMgt: Codeunit "CG X091 Setup Mgt";
    begin
        Initialize();
        SeedSetup('OLD-ROUTE', 50);
        SetupMgt.GetSetup(Setup);
        Stored.DeleteAll();
        SetupMgt.Invalidate();

        SetupMgt.GetSetup(Setup);

        Assert.IsTrue(Stored.Get(''),
            'Expected the call after Invalidate to re-create the row that had been deleted');
        Assert.RecordCount(Stored, 1);
        Assert.AreEqual('', Format(Setup."Default Route Code"),
            'Expected the re-created row to come back with default values, not the ones cached before the deletion');
        Assert.AreEqual(0.0, Setup."Max Batch Weight",
            'Expected the re-created row to come back with default values, not the ones cached before the deletion');
    end;

    [Test]
    procedure AnIndependentlyDeclaredVariableIsServedFromTheSameCacheWithoutHittingTheDatabase()
    var
        Setup: Record "CG X091 Setup";
        WarmSetupMgt: Codeunit "CG X091 Setup Mgt";
        ColdSetupMgt: Codeunit "CG X091 Setup Mgt";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        ZeroBig: BigInteger;
    begin
        // [SCENARIO] One part of the application warms the cache through its
        // own variable; a second, independently declared variable must be
        // served the same cached setup, not a fresh read of the row after
        // it has since changed underneath it.
        Initialize();
        SeedSetup('ROUTE-B', 275.25);
        WarmSetupMgt.GetSetup(Setup);

        // The row itself changes directly in the table after the cache was
        // warmed - a fresh read would see these new values; the shared
        // cache must not.
        UpdateStoredSetup('ROUTE-B-CHANGED', 999.99);

        // A DB-backed shared-store rewrite (e.g. a second table keyed by
        // session) would otherwise still pass the value asserts below by
        // legitimately reading its own just-written row for free from the
        // platform's record cache. SelectLatestVersion forces the next read
        // to bypass that cache, so any implementation that still touches the
        // database in this window pays for it here.
        SelectLatestVersion();

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        ColdSetupMgt.GetSetup(Setup);

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.AreEqual('ROUTE-B', Setup."Default Route Code",
            'Expected an independently declared variable to be served the same cached setup that was already read, not the row''s current value');
        Assert.AreEqual(275.25, Setup."Max Batch Weight",
            'Expected an independently declared variable to be served the same cached setup that was already read, not the row''s current value');
        Assert.AreEqual(ZeroBig, StmtDelta,
            StrSubstNo('Expected an independently declared variable to reuse the already-cached setup instead of reading the table again: budget %1, actual %2', 0, StmtDelta));
        Assert.AreEqual(ZeroBig, RowsDelta,
            StrSubstNo('Expected an independently declared variable to reuse the already-cached setup instead of reading the table again: rows budget %1, actual %2', 0, RowsDelta));
    end;
}
