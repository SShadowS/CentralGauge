codeunit 85742 "HX014 New Partner Plan" implements "CGR Maintenance Strategy", "CGR Service Interval"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 8000);
    end;

    procedure DefaultIntervalMonths(): Integer
    begin
        exit(9);
    end;
}
