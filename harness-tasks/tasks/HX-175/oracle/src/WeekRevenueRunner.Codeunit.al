codeunit 88586 "HX175 Week Revenue Runner"
{
    trigger OnRun()
    var
        WeeklyRevenueMgt: Codeunit "CGR Weekly Revenue Mgt";
    begin
        if ListMode then
            WeeklyRevenueMgt.GetYearWeeks(RunVehicleNo, RunYear, TempWeekBuffer)
        else
            WeeklyRevenueMgt.BuildWeekRevenue(RunVehicleNo);
    end;

    var
        TempWeekBuffer: Record "CGR Vehicle Week Revenue" temporary;
        RunVehicleNo: Code[20];
        RunYear: Integer;
        ListMode: Boolean;

    procedure SetBuild(VehicleNo: Code[20])
    begin
        RunVehicleNo := VehicleNo;
        ListMode := false;
    end;

    procedure SetList(VehicleNo: Code[20]; Year: Integer)
    begin
        RunVehicleNo := VehicleNo;
        RunYear := Year;
        ListMode := true;
        TempWeekBuffer.Reset();
        TempWeekBuffer.DeleteAll();
    end;

    procedure GetWeeks(var WeekBuffer: Record "CGR Vehicle Week Revenue" temporary)
    begin
        WeekBuffer.Reset();
        WeekBuffer.DeleteAll();
        TempWeekBuffer.Reset();
        if TempWeekBuffer.FindSet() then
            repeat
                WeekBuffer := TempWeekBuffer;
                WeekBuffer.Insert();
            until TempWeekBuffer.Next() = 0;
    end;
}
