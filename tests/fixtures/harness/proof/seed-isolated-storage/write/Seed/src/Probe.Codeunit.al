codeunit 74901 "CG Proof Seed Probe"
{
    // The read reaches this through Codeunit.Run(74901) (no dependency on this app, which stays installed past the
    // write's cleanup): OnRun fails while the Module-scoped seed is present.
    trigger OnRun()
    begin
        if Seeded() then
            Error('cg-proof-seed present');
    end;

    procedure Seeded(): Boolean
    begin
        exit(IsolatedStorage.Contains('cg-proof-seed', DataScope::Module));
    end;
}
