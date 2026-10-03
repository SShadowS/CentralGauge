codeunit 85861 "HX020 Failing Pause Run"
{
    trigger OnRun()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.SuspendQueueing();
        Error(StepFailedErr);
    end;

    var
        StepFailedErr: Label 'HX020 migration step failed.';
}
