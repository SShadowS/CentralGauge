codeunit 80651 "CGR Cancellation Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        PartnerRefusedErr: Label 'The partner app refused cancellation of contract %1.', Comment = '%1 = contract number';

    procedure RefuseCancellationOf(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    procedure ExpectedRefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationCompleted', '', false, false)]
    local procedure RefuseListedCancellation(Entry: Record "CGR Cancellation Entry")
    begin
        if Entry."Contract No." = RefusedContractNo then
            Error(PartnerRefusedErr, Entry."Contract No.");
    end;
}
