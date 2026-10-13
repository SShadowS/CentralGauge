codeunit 70009 "CGR Working Days"
{
    procedure IsWorkingDay(CheckDate: Date): Boolean
    var
        Company: Record Company;
        NonWorkingDay: Record "CGR Non-Working Day";
        GroupHoliday: Record "CGR Group Holiday";
    begin
        if Date2DWY(CheckDate, 1) in [6, 7] then
            exit(false);
        if Company.FindSet() then
            repeat
                GroupHoliday.ChangeCompany(Company.Name);
                if GroupHoliday.Get(CheckDate) then
                    exit(false);
                NonWorkingDay.ChangeCompany(Company.Name);
                if NonWorkingDay.Get(CheckDate) then
                    exit(false);
            until Company.Next() = 0;
        exit(true);
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
