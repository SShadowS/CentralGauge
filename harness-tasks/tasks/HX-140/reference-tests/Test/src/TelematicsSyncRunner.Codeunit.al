codeunit 80482 "CGR Telematics Sync Runner"
{
    var
        VehiclesSentInRun: Integer;

    trigger OnRun()
    var
        TelematicsSync: Codeunit "CGR Telematics Sync";
    begin
        VehiclesSentInRun := TelematicsSync.SyncAll();
    end;

    procedure VehiclesSent(): Integer
    begin
        exit(VehiclesSentInRun);
    end;
}
