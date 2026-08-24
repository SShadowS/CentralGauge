codeunit 70521 "CG X087 Document Copy Mgt"
{
    procedure CopyDocument(SourceNo: Code[20]; NewNo: Code[20])
    var
        SourceHeader: Record "CG X087 Document Header";
        NewHeader: Record "CG X087 Document Header";
    begin
        SourceHeader.Get(SourceNo);

        NewHeader.Init();
        NewHeader."No." := NewNo;
        NewHeader."Copied From No." := SourceHeader."No.";
        NewHeader.Description := SourceHeader.Description;
        NewHeader.Status := NewHeader.Status::Copied;
        NewHeader.Insert(true);

        OnAfterDocumentReleaseStep(NewHeader);
        OnAfterDocumentAuditStep(NewHeader);
    end;

    procedure AuditDocument(No: Code[20])
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.Get(No);
        OnAfterDocumentAuditStep(Header);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDocumentReleaseStep(var DocHeader: Record "CG X087 Document Header")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDocumentAuditStep(var DocHeader: Record "CG X087 Document Header")
    begin
    end;
}
