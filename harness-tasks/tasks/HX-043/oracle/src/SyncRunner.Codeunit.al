codeunit 86322 "HX043 Sync Runner"
{
    var
        SyncResult: Integer;

    trigger OnRun()
    var
        NightlySync: Codeunit "CGR Nightly Sync";
    begin
        SyncResult := -1;
        SyncResult := NightlySync.RunNightlySync();
    end;

    procedure LastResult(): Integer
    begin
        exit(SyncResult);
    end;
}
