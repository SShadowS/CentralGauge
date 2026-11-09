codeunit 80604 "CGR Due One Line Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        AccountingRefusalErr: Label 'Accounting refused lease %1.', Comment = '%1 = lease number';

    procedure RefuseLease(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Due Line Run", 'OnAfterInvoiceLine', '', false, false)]
    local procedure RefuseChosenLease(Line: Record "CGR Lease Schedule Line")
    begin
        if (RefusedContractNo <> '') and (Line."Contract No." = RefusedContractNo) then
            Error(AccountingRefusalErr, Line."Contract No.");
    end;
}
