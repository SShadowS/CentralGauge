codeunit 70009 "CGR Working Days"
{
    procedure IsWorkingDay(CheckDate: Date): Boolean
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        if Date2DWY(CheckDate, 1) in [6, 7] then
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

    procedure AddWorkingDays(FromDate: Date; Days: Integer): Date
    var
        NonWorkingDay: Record "CGR Non-Working Day";
        CurrDate: Date;
        Counted: Integer;
    begin
        if Days < 0 then
            Error('The number of working days to add must not be negative.');
        CurrDate := FromDate;
        while Counted < Days do begin
            CurrDate += 1;
            if not IsWeekendDay(CurrDate) then
                if not NonWorkingDay.Get(CurrDate) then
                    Counted += 1;
        end;
        exit(CurrDate);
    end;

    local procedure IsWeekendDay(D: Date): Boolean
    begin
        exit(Date2DWY(D, 1) in [1, 7]);
    end;
}
