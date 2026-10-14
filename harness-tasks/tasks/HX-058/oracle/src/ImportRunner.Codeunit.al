codeunit 86621 "HX058 Import Runner"
{
    var
        Readings: List of [Text];
        Updated: Integer;

    procedure SetReadings(NewReadings: List of [Text])
    begin
        Readings := NewReadings;
    end;

    procedure UpdatedCount(): Integer
    begin
        exit(Updated);
    end;

    trigger OnRun()
    var
        MileageImport: Codeunit "CGR Mileage Import";
    begin
        Updated := MileageImport.ImportMileage(Readings);
    end;
}
