codeunit 80136 "CGR Day Closing Test Runner"
{
    var
        RunBranchCode: Code[10];
        RunClosingDate: Date;

    trigger OnRun()
    var
        DayClosing: Codeunit "CGR Day Closing";
    begin
        DayClosing.CloseDay(RunBranchCode, RunClosingDate);
    end;

    procedure SetDayClosingRun(BranchCode: Code[10]; ClosingDate: Date)
    begin
        RunBranchCode := BranchCode;
        RunClosingDate := ClosingDate;
    end;
}
