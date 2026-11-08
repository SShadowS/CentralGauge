codeunit 80134 "CGR Try Day Report Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedBranchCode: Code[10];
        TryRefusedErr: Label 'Partner app refused the wrapped day report of branch %1.', Comment = '%1 = branch code';

    procedure RefuseWrappedReport(BranchCode: Code[10])
    begin
        RefusedBranchCode := BranchCode;
    end;

    procedure WrappedRefusalText(BranchCode: Code[10]): Text
    begin
        exit(StrSubstNo(TryRefusedErr, BranchCode));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Day Closing Run", 'OnAfterDayClosed', '', false, false)]
    local procedure WrappedReportRefused(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)
    begin
        if (RefusedBranchCode <> '') and (Branch.Code = RefusedBranchCode) then
            Error(TryRefusedErr, Branch.Code);
    end;
}
