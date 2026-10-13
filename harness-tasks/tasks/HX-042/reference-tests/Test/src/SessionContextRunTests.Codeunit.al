codeunit 80086 "CGR Session Context Run Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefreshKeepsChosenBranch()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.SetCurrentBranch('SOUTH');
        SessionContext.RefreshSetup();
        Assert.AreEqual('SOUTH', SessionContext.CurrentBranch(), 'A refresh of the setup keeps the chosen branch');
    end;

    [Test]
    procedure EmptyChosenBranchWins()
    var
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.SetCurrentBranch('');
        Assert.AreEqual('', SessionContext.CurrentBranch(), 'An empty chosen branch is still the chosen branch');
    end;

    [Test]
    procedure MissingSetupIsCachedAsEmpty()
    var
        Setup: Record "CGR Setup";
        Saved: Record "CGR Setup";
        Loaded: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        FirstBranch: Code[10];
        FirstPrecision: Decimal;
        CachedBranch: Code[10];
        CachedPrecision: Decimal;
        CachedCurrentBranch: Code[10];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Setup.Get();
        Saved := Setup;
        Setup.Delete();

        SessionContext.GetSetup(Loaded);
        FirstBranch := Loaded."Default Branch Code";
        FirstPrecision := Loaded."Amount Rounding Precision";

        // Recreate the row (keeping the number series) before any assertion can stop the test.
        Saved."Default Branch Code" := 'NORTH';
        Saved."Amount Rounding Precision" := 0.05;
        Saved.Insert();

        SessionContext.GetSetup(Loaded);
        CachedBranch := Loaded."Default Branch Code";
        CachedPrecision := Loaded."Amount Rounding Precision";
        CachedCurrentBranch := SessionContext.CurrentBranch();

        Assert.AreEqual('', FirstBranch, 'Without a setup row the loaded setup is empty');
        Assert.AreEqual(0.0, FirstPrecision, 'Without a setup row the loaded setup is empty');
        Assert.AreEqual('', CachedBranch, 'A setup row created later does not reach the loaded setup');
        Assert.AreEqual(0.0, CachedPrecision, 'A setup row created later does not reach the loaded setup');
        Assert.AreEqual('', CachedCurrentBranch, 'The default branch comes from the loaded, empty setup');

        SessionContext.RefreshSetup();
        SessionContext.GetSetup(Loaded);
        Assert.AreEqual('NORTH', Loaded."Default Branch Code", 'After a refresh the new setup row is loaded');
        Assert.AreEqual(0.05, Loaded."Amount Rounding Precision", 'After a refresh the new setup row is loaded');
    end;

    [Test]
    procedure DefaultBranchCachedUntilRefresh()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        Assert.AreEqual('NORTH', SessionContext.CurrentBranch(), 'The default branch of the loaded setup');

        Setup.Get();
        Setup."Default Branch Code" := 'WEST';
        Setup.Modify();
        Assert.AreEqual('NORTH', SessionContext.CurrentBranch(), 'A changed default reaches the session only after a refresh');

        SessionContext.RefreshSetup();
        Assert.AreEqual('WEST', SessionContext.CurrentBranch(), 'After a refresh the changed default applies');
    end;

    [Test]
    procedure RefreshLoadsOnNextRead()
    var
        Setup: Record "CGR Setup";
        Loaded: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.GetSetup(Loaded);
        Assert.AreEqual(0.01, Loaded."Amount Rounding Precision", 'First read loads the setup');

        SessionContext.RefreshSetup();
        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup."Default Branch Code" := 'WEST';
        Setup.Modify();

        SessionContext.GetSetup(Loaded);
        Assert.AreEqual(0.05, Loaded."Amount Rounding Precision", 'The read after a refresh loads the setup as it is then');
        Assert.AreEqual('WEST', SessionContext.CurrentBranch(), 'The default branch as it is at the read after the refresh');
    end;

    [Test]
    procedure DefaultEqualBranchStaysChosen()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.SetCurrentBranch('NORTH');

        Setup.Get();
        Setup."Default Branch Code" := 'WEST';
        Setup.Modify();
        SessionContext.RefreshSetup();
        Assert.AreEqual('NORTH', SessionContext.CurrentBranch(), 'A chosen branch equal to the old default stays chosen');
    end;

    [Test]
    procedure ResetClearsBranchAndSetup()
    var
        Setup: Record "CGR Setup";
        Loaded: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        SessionContext.SetCurrentBranch('SOUTH');
        SessionContext.GetSetup(Loaded);

        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup."Default Branch Code" := 'WEST';
        Setup.Modify();
        SessionContext.Reset();

        Assert.AreEqual('WEST', SessionContext.CurrentBranch(), 'Reset clears the chosen branch and the loaded setup');
        SessionContext.GetSetup(Loaded);
        Assert.AreEqual(0.05, Loaded."Amount Rounding Precision", 'Reset clears the loaded setup');
    end;

    [Test]
    procedure SecondInstanceSharesLoadedSetup()
    var
        Setup: Record "CGR Setup";
        Loaded: Record "CGR Setup";
        First: Codeunit "CGR Session Context";
        Second: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, 'NORTH', 3);
        First.GetSetup(Loaded);

        Setup.Get();
        Setup."Amount Rounding Precision" := 0.05;
        Setup.Modify();
        Second.GetSetup(Loaded);
        Assert.AreEqual(0.01, Loaded."Amount Rounding Precision", 'A second variable reads the setup the session loaded');

        Second.RefreshSetup();
        First.GetSetup(Loaded);
        Assert.AreEqual(0.05, Loaded."Amount Rounding Precision", 'A refresh through one variable reaches the other');
    end;
}
