// SPIKE (throwaway): seeds 3 rows so the foreign app has data to protect
codeunit 50301 "FP Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Row: Record "FP Row";
        I: Integer;
    begin
        for I := 1 to 3 do
            if not Row.Get(StrSubstNo('FP%1', I)) then begin
                Row.Init();
                Row."No." := StrSubstNo('FP%1', I);
                Row.Insert();
            end;
    end;
}
