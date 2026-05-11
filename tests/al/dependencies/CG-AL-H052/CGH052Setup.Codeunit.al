codeunit 69521 "CG H052 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        Seed();
    end;

    local procedure Seed()
    var
        A: Record "CG H052 Account";
    begin
        if not A.IsEmpty() then
            exit;
        Insert(A, 'A1', 'T1', 'Active');
        Insert(A, 'A2', 'T1', 'Inactive');
        Insert(A, 'A3', 'T2', 'Active');
        Insert(A, 'A4', 'T2', 'Active');
    end;

    local procedure Insert(var A: Record "CG H052 Account"; CodeVal: Code[20]; Tnt: Code[20]; Stat: Code[10])
    begin
        A.Init();
        A."Code" := CodeVal;
        A."Tenant Id" := Tnt;
        A."Status" := Stat;
        A.Insert();
    end;
}
