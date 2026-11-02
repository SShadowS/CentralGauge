codeunit 70265 "CGR Export Apply Handler"
{
    // Carries a new payment application over to the contract's payment export lines. A line is
    // touched only when its Applies-to ID changes; only Open lines get their amounts worked out again.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Payment Application", 'OnAfterApplyEntries', '', false, false)]
    local procedure HandleApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        ExportLineAmount: Codeunit "CGR Export Line Amount";
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        if ExportLine.FindSet(true) then
            repeat
                if ExportLine."Applies-to ID" <> AppliesToId then begin
                    ExportLine."Applies-to ID" := AppliesToId;
                    ExportLine.Modify();
                    if not (ExportLine.Status in [ExportLine.Status::Exported, ExportLine.Status::Sent]) then
                        ExportLineAmount.UpdateAmount(ExportLine);
                end;
            until ExportLine.Next() = 0;
    end;
}
