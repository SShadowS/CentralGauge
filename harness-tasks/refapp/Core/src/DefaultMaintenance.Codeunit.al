codeunit 70001 "CGR Default Maintenance" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 15000);
    end;
}
