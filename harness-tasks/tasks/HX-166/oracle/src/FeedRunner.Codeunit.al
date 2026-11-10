codeunit 88452 "HX166 Feed Runner"
{
    var
        RunCodes: List of [Code[20]];
        RunVehicles: List of [Code[20]];
        RunAmounts: List of [Text];
        RunResult: Integer;

    procedure SetFileHX166(EntryCodes: List of [Code[20]]; VehicleNos: List of [Code[20]]; AmountTexts: List of [Text])
    begin
        RunCodes := EntryCodes;
        RunVehicles := VehicleNos;
        RunAmounts := AmountTexts;
    end;

    procedure ResultHX166(): Integer
    begin
        exit(RunResult);
    end;

    trigger OnRun()
    var
        Feed: Codeunit "CGR Fuel Card Feed";
    begin
        RunResult := Feed.ImportFuelCardFile(RunCodes, RunVehicles, RunAmounts);
    end;
}
