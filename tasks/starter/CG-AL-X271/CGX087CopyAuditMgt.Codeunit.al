codeunit 70523 "CG X087 Copy Audit Mgt"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X087 Document Copy Mgt", 'OnAfterDocumentAuditStep', '', false, false)]
    local procedure MarkDocumentAudited(var DocHeader: Record "CG X087 Document Header")
    begin
        // Flag the copy for the audit trail without re-running OnModify logic.
        DocHeader."Copy Audited" := true;
        DocHeader.Modify(false);
    end;
}
