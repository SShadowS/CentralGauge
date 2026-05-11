codeunit 69571 "CG H057 Setup"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        Seed();
    end;

    local procedure Seed()
    var
        S: Record "CG H057 Sample";
    begin
        if not S.IsEmpty() then
            exit;
        Insert(S, 'A', 'short');
        Insert(S, 'B', 'a medium length description');
        Insert(S, 'C', 'an extremely long descriptive payload that exceeds twenty characters by a comfortable margin');
    end;

    local procedure Insert(var S: Record "CG H057 Sample"; CodeVal: Code[20]; Desc: Text[100])
    begin
        S.Init();
        S."Code" := CodeVal;
        S."Description" := Desc;
        S."Touch Count" := 0;
        S.Insert();
    end;
}
