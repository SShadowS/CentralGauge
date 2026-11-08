codeunit 80508 "CGR Overdue Fee Single Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        RefusedErr: Label 'Partner refused contract %1.', Comment = '%1 = contract number';

    procedure RefuseContract(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Overdue Fee Charge", 'OnBeforeChargeOverdueFee', '', false, false)]
    local procedure RefuseSingleNight(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (RefusedContractNo <> '') and (Contract."No." = RefusedContractNo) then
            Error(RefusedErr, Contract."No.");
    end;
}
