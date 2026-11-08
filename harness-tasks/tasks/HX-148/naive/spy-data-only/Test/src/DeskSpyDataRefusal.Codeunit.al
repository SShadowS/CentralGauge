codeunit 80557 "CGR Desk Spy Data Refusal"
{
    EventSubscriberInstance = Manual;

    var
        SpyDataRefusedNo: Code[20];
        SpyDataRefusedErr: Label 'The payment partner refused the posting of contract %1.', Comment = '%1 = contract number';

    procedure RefuseSpyDataPosting(ContractNo: Code[20])
    begin
        SpyDataRefusedNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure RefuseSpyDataPostingOfContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if (SpyDataRefusedNo <> '') and (RentalContract."No." = SpyDataRefusedNo) then
            Error(SpyDataRefusedErr, RentalContract."No.");
    end;
}
