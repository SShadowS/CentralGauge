codeunit 79601 "CG Proof Seed Probe"
{
    procedure Seeded(): Boolean
    var
        Entry: Record "Job Queue Entry";
    begin
        Entry.SetRange(Description, 'cg-proof-seed');
        exit(not Entry.IsEmpty());
    end;
}
