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

    [Test]
    procedure NotAuditedWhenChangeLogInactive()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log globally INACTIVE (even though the User table is
        // always logged once the global flag is on)
        SetActivated(false);

        // [WHEN/THEN] The detector must report no auditing
        Assert.IsFalse(
            AuditCheck.WouldLogUserChanges(),
            'Must return false when the global Change Log is not activated');
    end;

    [Test]
    procedure AuditedWhenActivatedAndConfigured()
    var
        AuditCheck: Codeunit "CG X003 Audit Check";
    begin
        // [GIVEN] Change Log activated AND the User table logging modifications
        SetActivated(true);
        ConfigureUserLogging();

        // [WHEN/THEN] The detector reports auditing active
        Assert.IsTrue(
            AuditCheck.WouldLogUserChanges(),
            'Must return true when activated and the table logs modifications');

        // cleanup so other tests in a shared session see a clean flag
        SetActivated(false);
    end;
}
