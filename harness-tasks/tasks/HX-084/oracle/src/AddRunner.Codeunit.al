codeunit 87141 "HX084 Add Runner"
{
    var
        StartDate: Date;
        DaysToAdd: Integer;

    procedure SetArgs(NewStartDate: Date; NewDaysToAdd: Integer)
    begin
        StartDate := NewStartDate;
        DaysToAdd := NewDaysToAdd;
    end;

    trigger OnRun()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkingDays.AddWorkingDays(StartDate, DaysToAdd);
    end;
}
