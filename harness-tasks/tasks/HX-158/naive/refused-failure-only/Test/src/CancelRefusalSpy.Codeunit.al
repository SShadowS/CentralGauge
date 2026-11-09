codeunit 80655 "CGR Cancel Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusalContractNo: Code[20];
        RefusalErr: Label 'Refused by partner: %1.', Comment = '%1 = contract number';

    procedure RefuseContract(ContractNo: Code[20])
    begin
        RefusalContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationCompleted', '', false, false)]
    local procedure RefuseOnCompleted(Entry: Record "CGR Cancellation Entry")
    begin
        if Entry."Contract No." = RefusalContractNo then
            Error(RefusalErr, Entry."Contract No.");
    end;
}
