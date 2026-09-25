codeunit 85202 "HX3 Short Interval" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 1000);
    end;
}
