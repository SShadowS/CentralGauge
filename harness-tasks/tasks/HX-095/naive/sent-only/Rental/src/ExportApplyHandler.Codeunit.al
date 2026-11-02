codeunit 70265 "CGR Export Apply Handler"
{
    // Carries a new payment application over to the contract's payment export lines. Every line
    // follows the new Applies-to ID; only lines the partner has not confirmed are recalculated.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Payment Application", 'OnAfterApplyEntries', '', false, false)]
    local procedure HandleApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        ExportLineAmount: Codeunit "CGR Export Line Amount";
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        if ExportLine.FindSet(true) then
            repeat
                ExportLine."Applies-to ID" := AppliesToId;
                ExportLine.Modify();
                if ExportLine.Status <> ExportLine.Status::Sent then
                    ExportLineAmount.UpdateAmount(ExportLine);
            until ExportLine.Next() = 0;
    end;
}
