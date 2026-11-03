codeunit 79601 "CG Proof Seed Probe"
{
    procedure Seeded(): Boolean
    begin
        exit(IsolatedStorage.Contains('cg-proof-seed', DataScope::Module));
    end;
}
