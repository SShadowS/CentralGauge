// SPIKE (throwaway): harness bench M4-16 premise probe
// Seeds 3 committed rows at install, before any test transaction (P1 control c).
codeunit 50204 "M16P Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Row: Record "M16P Committed Row";
        I: Integer;
    begin
        Row.DeleteAll();
        for I := 1 to 3 do begin
            Row.Init();
            Row."No." := StrSubstNo('C%1', I);
            Row.Insert();
        end;
    end;
}
