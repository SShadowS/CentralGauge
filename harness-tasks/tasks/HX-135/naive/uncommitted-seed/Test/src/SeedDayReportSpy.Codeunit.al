codeunit 80139 "CGR Seed Day Report Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedBranchCode: Code[10];
        SeedRefusedErr: Label 'Partner app refused the seeded day report of branch %1.', Comment = '%1 = branch code';

    procedure RefuseSeedReport(BranchCode: Code[10])
    begin
        RefusedBranchCode := BranchCode;
    end;

    procedure SeedRefusalText(BranchCode: Code[10]): Text
    begin
        exit(StrSubstNo(SeedRefusedErr, BranchCode));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Day Closing Run", 'OnAfterDayClosed', '', false, false)]
    local procedure SeedReportRefused(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)
    begin
        if (RefusedBranchCode <> '') and (Branch.Code = RefusedBranchCode) then
            Error(SeedRefusedErr, Branch.Code);
    end;
}
