codeunit 79601 "CG Proof Seed Probe"
{
    procedure Seeded(): Boolean
    var
        Task: Record "Scheduled Task";
    begin
        Task.SetRange("Run Codeunit", Codeunit::"CG Proof Seed Probe");
        exit(not Task.IsEmpty());
    end;
}
