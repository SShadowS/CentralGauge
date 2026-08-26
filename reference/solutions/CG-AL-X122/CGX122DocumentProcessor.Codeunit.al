codeunit 70822 "CG X122 Document Processor"
{
    procedure ReleaseDocument(DocNo: Code[20])
    var
        Document: Record "CG X122 Document";
    begin
        Document.Get(DocNo);
        Document.Status := Document.Status::Released;
        Document.Modify();
        OnDocumentReleased(DocNo);
    end;

    procedure CancelDocument(DocNo: Code[20])
    var
        Document: Record "CG X122 Document";
    begin
        Document.Get(DocNo);
        Document.Status := Document.Status::Cancelled;
        Document.Modify();
        OnDocumentCancelled(DocNo);
    end;

    procedure RunNightlyReleaseJob()
    var
        Document: Record "CG X122 Document";
    begin
        Document.SetRange(Status, Document.Status::Open);
        if Document.FindSet() then
            repeat
                if Document.Amount < 0 then
                    CancelDocument(Document."No.")
                else
                    ReleaseDocument(Document."No.");
            until Document.Next() = 0;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnDocumentReleased(DocNo: Code[20])
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnDocumentCancelled(DocNo: Code[20])
    begin
    end;
}
