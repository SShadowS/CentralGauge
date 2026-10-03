codeunit 70009 "CGR Working Days"
{
    procedure IsWeekend(CheckDate: Date): Boolean
    begin
        exit(Date2DWY(CheckDate, 1) in [6, 7]);
    end;

    procedure IsWorkingDay(CheckDate: Date): Boolean
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        if IsWeekend(CheckDate) then
            exit(false);
        exit(not NonWorkingDay.Get(CheckDate));
    end;

    procedure WorkingDaysBetween(FromDate: Date; ToDate: Date): Integer
    var
        CurrDate: Date;
        Result: Integer;
    begin
        if ToDate < FromDate then
            exit(0);
        CurrDate := FromDate;
        while CurrDate <= ToDate do begin
            if IsWorkingDay(CurrDate) then
                Result += 1;
            CurrDate += 1;
        end;
        exit(Result);
    end;

    procedure NextWorkingDay(FromDate: Date): Date
    var
        Result: Date;
    begin
        Result := FromDate + 1;
        while not IsWorkingDay(Result) do
            Result += 1;
        exit(Result);
    end;
}
