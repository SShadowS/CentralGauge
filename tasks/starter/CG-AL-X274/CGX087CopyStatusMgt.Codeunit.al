codeunit 70522 "CG X087 Copy Status Mgt"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X087 Document Copy Mgt", 'OnAfterDocumentReleaseStep', '', false, false)]
    local procedure AutoReleaseCopiedDocument(var DocHeader: Record "CG X087 Document Header")
    var
        DocumentHeader: Record "CG X087 Document Header";
    begin
        // Newly copied documents are ready for processing immediately.
        DocumentHeader.Get(DocHeader."No.");
        DocumentHeader.Status := DocumentHeader.Status::Released;
        DocumentHeader."Release Reference" := 'REL-' + DocumentHeader."No.";
        DocumentHeader.Modify(true);
    end;
}
