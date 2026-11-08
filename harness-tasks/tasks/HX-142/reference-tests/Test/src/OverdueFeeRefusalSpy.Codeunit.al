codeunit 80502 "CGR Overdue Fee Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        PartnerRefusedErr: Label 'The payment partner refused the overdue fee of contract %1.', Comment = '%1 = contract number';

    procedure RefuseOverdueFee(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Overdue Fee Charge", 'OnBeforeChargeOverdueFee', '', false, false)]
    local procedure RefuseOverdueFeeOfContract(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (RefusedContractNo <> '') and (Contract."No." = RefusedContractNo) then
            Error(PartnerRefusedErr, Contract."No.");
    end;
}
