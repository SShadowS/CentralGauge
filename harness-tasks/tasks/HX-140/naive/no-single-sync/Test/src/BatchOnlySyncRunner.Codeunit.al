codeunit 80487 "CGR Batch Only Sync Runner"
{
    trigger OnRun()
    var
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        TelematicsSync.SyncAll();
    end;
}
