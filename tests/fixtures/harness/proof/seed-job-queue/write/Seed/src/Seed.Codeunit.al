codeunit 79600 "CG Proof Seed Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    var
        Entry: Record "Job Queue Entry";
    begin
        // On Hold: the entry is never run, it only has to persist.
        Entry.Init();
        Entry.ID := CreateGuid();
        Entry."Object Type to Run" := Entry."Object Type to Run"::Codeunit;
        Entry."Object ID to Run" := Codeunit::"CG Proof Seed Probe";
        Entry.Status := Entry.Status::"On Hold";
        Entry.Description := 'cg-proof-seed';
        Entry.Insert();
    end;
}
