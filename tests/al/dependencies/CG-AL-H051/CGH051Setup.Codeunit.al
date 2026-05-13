codeunit 69511 "CG H051 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        Seed();
    end;

    local procedure Seed()
    var
        S: Record "CG H051 Sample";
    begin
        if not S.IsEmpty() then
            exit;
        Insert(S, 'A', 'G1');
        Insert(S, 'B', 'G1');
        Insert(S, 'C', 'G2');
        Insert(S, 'D', 'G1');
        Insert(S, 'E', 'G2');
    end;

    local procedure Insert(var S: Record "CG H051 Sample"; CodeVal: Code[20]; Grp: Code[10])
    begin
        S.Init();
        S."Code" := CodeVal;
        S."Group" := Grp;
        S.Insert();
    end;
}
