codeunit 70238 "CGR Day Closing"
{
    var
        AlreadyRunningErr: Label 'The day closing of branch %1 is already running.', Comment = '%1 = branch code';

    procedure CloseDay(BranchCode: Code[10]; ClosingDate: Date)
    var
        Branch: Record "CGR Rental Branch";
        ClosingRun: Codeunit "CGR Day Closing Run";
        Closed: Boolean;
    begin
        Branch.Get(BranchCode);
        if Branch."Day Closing Running" then
            Error(AlreadyRunningErr, BranchCode);
        Branch."Day Closing Running" := true;
        Branch.Modify();
        Commit();

        ClosingRun.SetDayToClose(ClosingDate);
        ClearLastError();
        Closed := ClosingRun.Run(Branch);

        Branch.Get(BranchCode);
        Branch."Day Closing Running" := false;
        if Closed then
            Branch."Last Closed Date" := ClosingDate;
        Branch.Modify();
        Commit();
    end;
}
