codeunit 70265 "CGR Export Apply Handler"
{
    // Carries a new payment application over to the contract's Open payment export lines.
    // Exported and Sent lines are left alone.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Payment Application", 'OnAfterApplyEntries', '', false, false)]
    local procedure HandleApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        ExportLineAmount: Codeunit "CGR Export Line Amount";
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        if ExportLine.FindSet(true) then
            repeat
                if not (ExportLine.Status in [ExportLine.Status::Exported, ExportLine.Status::Sent]) then begin
                    ExportLine."Applies-to ID" := AppliesToId;
                    ExportLine.Modify();
                    ExportLineAmount.UpdateAmount(ExportLine);
                end;
            until ExportLine.Next() = 0;
    end;
}
