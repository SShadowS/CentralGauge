codeunit 74900 "CG Proof Seed Install"
{
    Subtype = Install;

    trigger OnInstallAppPerCompany()
    begin
        // Not ready and a day out: the task is never run, it only has to persist.
        TaskScheduler.CreateTask(
            Codeunit::"CG Proof Seed Probe", 0, false, CompanyName(),
            CurrentDateTime() + 86400000);
    end;
}
