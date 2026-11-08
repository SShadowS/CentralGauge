codeunit 80552 "CGR Desk Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        DeskRefusedNo: Code[20];
        DeskPartnerRefusedErr: Label 'The payment partner refused the posting of contract %1.', Comment = '%1 = contract number';

    procedure RefuseDeskPosting(ContractNo: Code[20])
    begin
        DeskRefusedNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure RefuseDeskPostingOfContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (DeskRefusedNo <> '') and (RentalContract."No." = DeskRefusedNo) then
            Error(DeskPartnerRefusedErr, RentalContract."No.");
    end;
}
