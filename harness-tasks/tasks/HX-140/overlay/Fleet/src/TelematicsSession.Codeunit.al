codeunit 70151 "CGR Telematics Session"
{
    SingleInstance = true;

    var
        TelematicsBatchMark: Codeunit "CGR Telematics Batch Mark";

    procedure BeginBatch()
    begin
        BindSubscription(TelematicsBatchMark);
    end;

    procedure EndBatch()
    begin
        UnbindSubscription(TelematicsBatchMark);
    end;
}
