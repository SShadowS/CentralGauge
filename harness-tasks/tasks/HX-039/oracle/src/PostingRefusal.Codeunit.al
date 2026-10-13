codeunit 86241 "HX039 Posting Refusal"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContracts: List of [Code[20]];
        CommittingContracts: List of [Code[20]];
        RefusedErr: Label 'HX039 refuses %1.', Comment = '%1 = contract number';

    procedure RefuseContract(ContractNo: Code[20]; CommitFirst: Boolean)
    begin
        if not RefusedContracts.Contains(ContractNo) then
            RefusedContracts.Add(ContractNo);
        if CommitFirst and not CommittingContracts.Contains(ContractNo) then
            CommittingContracts.Add(ContractNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure HandleAfterPostRentalContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
        if CommittingContracts.Contains(RentalContract."No.") then
            Commit();
        if RefusedContracts.Contains(RentalContract."No.") then
            Error(RefusedErr, RentalContract."No.");
    end;
}
