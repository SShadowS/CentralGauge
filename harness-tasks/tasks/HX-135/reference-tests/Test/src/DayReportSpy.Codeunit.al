codeunit 80137 "CGR Day Report Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedBranchCode: Code[10];
        DayReportCalls: Integer;
        FlagStoredDuringReport: Boolean;
        DayReportRefusedErr: Label 'The partner app refused the day report of branch %1.', Comment = '%1 = branch code';

    procedure RefuseDayReport(BranchCode: Code[10])
    begin
        RefusedBranchCode := BranchCode;
    end;

    procedure DayReportRefusalText(BranchCode: Code[10]): Text
    begin
        exit(StrSubstNo(DayReportRefusedErr, BranchCode));
    end;

    procedure DayReportsSent(): Integer
    begin
        exit(DayReportCalls);
    end;

    procedure RunningFlagStoredDuringReport(): Boolean
    begin
        exit(FlagStoredDuringReport);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Day Closing Run", 'OnAfterDayClosed', '', false, false)]
    local procedure SendDayReport(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)
    var
        StoredBranch: Record "CGR Rental Branch";
    begin
        DayReportCalls += 1;
        StoredBranch.Get(Branch.Code);
        FlagStoredDuringReport := StoredBranch."Day Closing Running";
        if (RefusedBranchCode <> '') and (Branch.Code = RefusedBranchCode) then
            Error(DayReportRefusedErr, Branch.Code);
    end;
}
