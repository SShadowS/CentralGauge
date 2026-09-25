codeunit 70101 "CGR Heavy Duty Maintenance" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 5000);
    end;
}
