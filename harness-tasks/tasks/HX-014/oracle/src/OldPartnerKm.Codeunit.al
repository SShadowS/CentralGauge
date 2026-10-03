codeunit 85741 "HX014 Old Partner Km" implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 8000);
    end;
}
