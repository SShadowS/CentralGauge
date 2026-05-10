codeunit 69371 "CG H037 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Doc: Record "CG H037 Doc";
    begin
        if Doc.Count > 0 then
            exit;

        InsertOne('R1', 'RELEASED');
        InsertOne('R2', 'RELEASED');
        InsertOne('O1', 'OPEN');
        InsertOne('O2', 'OPEN');
        InsertOne('P1', 'PENDING');
    end;

    local procedure InsertOne(CodeVal: Code[20]; StatusVal: Code[10])
    var
        Doc: Record "CG H037 Doc";
    begin
        Doc.Init();
        Doc.Code := CodeVal;
        Doc.Status := StatusVal;
        Doc.Migrated := false;
        Doc.Insert();
    end;
}
