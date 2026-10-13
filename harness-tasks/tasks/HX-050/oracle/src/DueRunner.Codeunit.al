codeunit 86461 "HX050 Due Runner"
{
    var
        Mode: Option Days,DueSoon,Due;
        RunVehicleNo: Code[20];
        RunAtDate: Date;
        RunWindowDays: Integer;
        RunResult: Boolean;
        RunDays: Integer;

    trigger OnRun()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        case Mode of
            Mode::Days:
                RunResult := ServicePlanMgt.DaysToPlannedService(RunVehicleNo, RunAtDate, RunDays);
            Mode::DueSoon:
                RunResult := ServicePlanMgt.IsServiceDueSoon(RunVehicleNo, RunAtDate, RunWindowDays);
            Mode::Due:
                RunResult := ServicePlanMgt.IsServiceDue(RunVehicleNo, RunAtDate);
        end;
    end;

    procedure SetDaysCall(VehicleNo: Code[20]; AtDate: Date)
    begin
        Mode := Mode::Days;
        Configure(VehicleNo, AtDate, 0);
    end;

    procedure SetDueSoonCall(VehicleNo: Code[20]; AtDate: Date; WindowDays: Integer)
    begin
        Mode := Mode::DueSoon;
        Configure(VehicleNo, AtDate, WindowDays);
    end;

    procedure SetDueCall(VehicleNo: Code[20]; AtDate: Date)
    begin
        Mode := Mode::Due;
        Configure(VehicleNo, AtDate, 0);
    end;

    procedure Result(): Boolean
    begin
        exit(RunResult);
    end;

    procedure Days(): Integer
    begin
        exit(RunDays);
    end;

    local procedure Configure(VehicleNo: Code[20]; AtDate: Date; WindowDays: Integer)
    begin
        RunVehicleNo := VehicleNo;
        RunAtDate := AtDate;
        RunWindowDays := WindowDays;
        // Preset to values no correct call leaves, so a false result and Days 0 are observed, not inherited.
        RunResult := true;
        RunDays := 77;
    end;
}
