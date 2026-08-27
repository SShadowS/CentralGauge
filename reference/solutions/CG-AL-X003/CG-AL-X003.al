codeunit 70920 "CG X003 Audit Check"
{
    Access = Internal;

    procedure WouldLogUserChanges(): Boolean
    var
        ChangeLogSetup: Record "Change Log Setup";
        ChangeLogMgt: Codeunit "Change Log Management";
    begin
        // The standard Change Log only records anything when it is globally activated.
        // Note: Change Log Management.IsLogActive treats the User table as an
        // "always logged" table and returns true even when the Change Log is not
        // activated, so we must explicitly verify global activation first.
        if not ChangeLogSetup.Get() then
            exit(false);
        if not ChangeLogSetup."Change Log Activated" then
            exit(false);

        // TypeOfChange: 0 = Insertion, 1 = Modification, 2 = Deletion
        exit(ChangeLogMgt.IsLogActive(Database::User, 0, 1));
    end;
}