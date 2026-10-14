codeunit 80120 "CGR Test City Car Maint." implements "CGR Maintenance Strategy"
{
    procedure NextServiceKm(CurrentKm: Integer): Integer
    begin
        exit(CurrentKm + 10000);
    end;
}
