codeunit 86081 "HX031 Posting Refusal"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        RefusedErr: Label 'HX031 refuses %1.', Comment = '%1 = contract number';

    procedure RefuseContract(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure RefuseAfterPost(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (RefusedContractNo = '') or (RentalContract."No." <> RefusedContractNo) then
            exit;
        Error(RefusedErr, RentalContract."No.");
    end;
}
