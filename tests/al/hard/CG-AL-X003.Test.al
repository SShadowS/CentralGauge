codeunit 80292 "CG-AL-X003 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure SetActivated(Activated: Boolean)
    var
        ChangeLogSetup: Record "Change Log Setup";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        if not ChangeLogSetup.Get() then begin
            ChangeLogSetup.Init();
            ChangeLogSetup.Insert();
        end;
        ChangeLogSetup."Change Log Activated" := Activated;
        ChangeLogSetup.Modify();
        ChangeLogMgt.InitChangeLog();
    end;

    local procedure ConfigureUserLogging()
    var
        ChangeLogSetupTable: Record "Change Log Setup (Table)";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        if not ChangeLogSetupTable.Get(Database::User) then begin
            ChangeLogSetupTable.Init();
            ChangeLogSetupTable."Table No." := Database::User;
            ChangeLogSetupTable.Insert();
        end;
        ChangeLogSetupTable."Log Modification" := ChangeLogSetupTable."Log Modification"::"All Fields";
        ChangeLogSetupTable.Modify();
        ChangeLogMgt.InitChangeLog();
    end;

    local procedure RemoveUserLoggingConfig()
    var
        ChangeLogSetupTable: Record "Change Log Setup (Table)";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        if ChangeLogSetupTable.Get(Database::User) then
            ChangeLogSetupTable.Delete();
        ChangeLogMgt.InitChangeLog();
    end;

    local procedure ResetChangeLogState()
    begin
        // Fully reverts container session state: no per-table "User" config
        // row, global flag off, SingleInstance cache refreshed. Called at the
        // start AND end of every test so no test depends on what a prior test
        // (or a prior test run on a shared container) left behind.
        RemoveUserLoggingConfig();
        SetActivated(false);
    end;

    [Test]
    procedure NotAuditedWhenChangeLogInactive()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log globally INACTIVE (even though "User" may be in
        // the always-logged set once the global flag is on)
        ResetChangeLogState();

        // [WHEN/THEN] The detector must report no auditing
        Assert.IsFalse(
            AuditCheck.WouldLogUserChanges(),
            'Must return false when the global Change Log is not activated');

        // [TEARDOWN] leave the container session as it was found
        ResetChangeLogState();
    end;

    [Test]
    procedure AuditedWhenActivatedWithoutExplicitConfig()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log ACTIVE and "User" has NO row in
        // Change Log Setup (Table) -- any positive result here can only come
        // from the platform's always-logged short-circuit, not explicit
        // per-table configuration
        ResetChangeLogState();
        SetActivated(true);

        // [WHEN/THEN] The detector still reports auditing active
        Assert.IsTrue(
            AuditCheck.WouldLogUserChanges(),
            'Must return true when activated, even without an explicit per-table configuration row, because "User" is always logged');

        // [TEARDOWN]
        ResetChangeLogState();
    end;

    [Test]
    procedure AuditedWhenActivatedAndExplicitlyConfigured()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log ACTIVE and "User" explicitly configured to log
        // modifications
        ResetChangeLogState();
        SetActivated(true);
        ConfigureUserLogging();

        // [WHEN/THEN] The detector reports auditing active
        Assert.IsTrue(
            AuditCheck.WouldLogUserChanges(),
            'Must return true when activated and the table is explicitly configured to log modifications');

        // [TEARDOWN]
        ResetChangeLogState();
    end;
}
