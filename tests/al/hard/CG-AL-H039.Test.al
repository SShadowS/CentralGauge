codeunit 80254 "CG-AL-H039 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Init: Codeunit "CG H039 Init";

    [Test]
    procedure TestSeedDefaults_FirstCallInsertsTwoRows()
    var
        Setting: Record "CG H039 Setting";
    begin
        // AutoRollback default: each test rolls back at the end, so setup is implicit.
        Init.SeedDefaults();

        Assert.AreEqual(2, Setting.Count, 'First call must insert exactly 2 rows.');
        Assert.IsTrue(Setting.Get('GREETING'), 'GREETING row must exist.');
        Assert.AreEqual('Hello', Setting.Value, 'GREETING value must be Hello.');
        Assert.IsTrue(Setting.Get('LANG'), 'LANG row must exist.');
        Assert.AreEqual('EN', Setting.Value, 'LANG value must be EN.');
    end;

    [Test]
    procedure TestSeedDefaults_SecondCallIsNoOp()
    var
        Setting: Record "CG H039 Setting";
        AfterFirst: Integer;
    begin
        Init.SeedDefaults();
        AfterFirst := Setting.Count;

        Init.SeedDefaults();

        Assert.AreEqual(AfterFirst, Setting.Count, 'Second call must not insert additional rows; HasUpgradeTag guard must short-circuit.');
        Assert.AreEqual(2, Setting.Count, 'Total row count must remain exactly 2.');
    end;

    [Test]
    procedure TestSeedDefaults_SetsRequiredUpgradeTag()
    var
        UpgradeTag: Codeunit "Upgrade Tag";
    begin
        // After SeedDefaults, the platform must record the upgrade tag literal.
        Init.SeedDefaults();

        Assert.IsTrue(
            UpgradeTag.HasUpgradeTag('CG-H039-SEED-DEFAULTS-20260101'),
            'SeedDefaults must call SetUpgradeTag with ''CG-H039-SEED-DEFAULTS-20260101''.');
    end;

    [Test]
    procedure TestSeedDefaults_NoErrorWhenCalledThreeTimes()
    var
        Setting: Record "CG H039 Setting";
    begin
        // Three calls must produce the same final state - the guard must short-circuit
        // every call after the first without attempting any Insert (which would error
        // on PK collision).
        Init.SeedDefaults();
        Init.SeedDefaults();
        Init.SeedDefaults();

        Assert.AreEqual(2, Setting.Count, 'Three calls must leave exactly 2 rows.');
    end;
}
