codeunit 70001 "CGR Default Maintenance" implements "CGR Maintenance Strategy", "CGR Service Interval"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 15000);
    end;

    procedure DefaultIntervalMonths(): Integer
    begin
        exit(12);
    end;
}
