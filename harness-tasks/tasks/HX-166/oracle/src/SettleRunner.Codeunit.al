codeunit 88451 "HX166 Settle Runner"
{
    var
        RunVehicle: Record "CGR Vehicle";
        RunFrom: Date;
        RunTo: Date;
        RunAllowance: Integer;
        RunResult: Integer;

    procedure SetSettleHX166(VehicleNo: Code[20]; FromDate: Date; ToDate: Date; AllowanceKm: Integer)
    begin
        RunVehicle.SetRange("No.", VehicleNo);
        RunFrom := FromDate;
        RunTo := ToDate;
        RunAllowance := AllowanceKm;
    end;

    procedure ResultHX166(): Integer
    begin
        exit(RunResult);
    end;

    trigger OnRun()
    var
        Settlement: Codeunit "CGR Usage Settlement";
    begin
        RunResult := Settlement.SettleUsagePeriod(RunVehicle, RunFrom, RunTo, RunAllowance);
    end;
}
