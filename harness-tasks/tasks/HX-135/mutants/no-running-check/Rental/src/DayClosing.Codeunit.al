codeunit 70238 "CGR Day Closing"
{
    procedure CloseDay(BranchCode: Code[10]; ClosingDate: Date)
    var
        Branch: Record "CGR Rental Branch";
        ClosingRun: Codeunit "CGR Day Closing Run";
        ErrorText: Text;
        Closed: Boolean;
    begin
        Branch.Get(BranchCode);
        Branch."Day Closing Running" := true;
        Branch.Modify();
        Commit();

        ClosingRun.SetDayToClose(ClosingDate);
        ClearLastError();
        Closed := ClosingRun.Run(Branch);
        if not Closed then
            ErrorText := GetLastErrorText();

        Branch.Get(BranchCode);
        Branch."Day Closing Running" := false;
        if Closed then
            Branch."Last Closed Date" := ClosingDate;
        Branch.Modify();
        Commit();
        if not Closed then
            Error(ErrorText);
    end;
}
