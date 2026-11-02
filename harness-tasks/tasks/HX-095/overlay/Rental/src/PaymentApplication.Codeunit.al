codeunit 70263 "CGR Payment Application"
{
    // Applies a contract's payment entries under an Applies-to ID: the listed entries get the ID,
    // the contract's other entries lose theirs.
    procedure ApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20]; var EntryNos: List of [Integer])
    var
        PaymentEntry: Record "CGR Customer Payment Entry";
    begin
        PaymentEntry.SetRange("Contract No.", ContractNo);
        if PaymentEntry.FindSet(true) then
            repeat
                if EntryNos.Contains(PaymentEntry."Entry No.") then
                    PaymentEntry."Applies-to ID" := AppliesToId
                else
                    PaymentEntry."Applies-to ID" := '';
                PaymentEntry.Modify();
            until PaymentEntry.Next() = 0;

        OnAfterApplyEntries(ContractNo, AppliesToId);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20])
    begin
    end;
}
