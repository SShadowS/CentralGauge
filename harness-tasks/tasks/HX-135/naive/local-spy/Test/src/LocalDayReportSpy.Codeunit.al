codeunit 80132 "CGR Local Day Report Spy"
{
    EventSubscriberInstance = Manual;

    var
        LocalRefusedBranch: Code[10];
        LocalReportCalls: Integer;
        LocalRefusedErr: Label 'Partner app refused the local day report of branch %1.', Comment = '%1 = branch code';

    procedure SetLocalRefusal(BranchCode: Code[10])
    begin
        LocalRefusedBranch := BranchCode;
    end;

    procedure LocalRefusalText(BranchCode: Code[10]): Text
    begin
        exit(StrSubstNo(LocalRefusedErr, BranchCode));
    end;

    procedure LocalReportsSent(): Integer
    begin
        exit(LocalReportCalls);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Day Closing Run", 'OnAfterDayClosed', '', false, false)]
    local procedure LocalDayReport(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)
    begin
        LocalReportCalls += 1;
        if (LocalRefusedBranch <> '') and (Branch.Code = LocalRefusedBranch) then
            Error(LocalRefusedErr, Branch.Code);
    end;
}
