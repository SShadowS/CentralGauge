codeunit 74900 "CG Proof Seed Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        IsolatedStorage.Set('cg-proof-seed', 'cg-proof-seed', DataScope::Module);
    end;
}
