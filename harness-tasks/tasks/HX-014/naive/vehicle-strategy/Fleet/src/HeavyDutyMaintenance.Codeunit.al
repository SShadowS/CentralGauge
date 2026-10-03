codeunit 70101 "CGR Heavy Duty Maintenance" implements "CGR Maintenance Strategy", "CGR Service Interval"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 5000);
    end;

    procedure DefaultIntervalMonths(): Integer
    begin
        exit(6);
    end;
}
