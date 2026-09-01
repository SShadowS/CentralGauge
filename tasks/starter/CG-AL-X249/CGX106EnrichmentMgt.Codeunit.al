codeunit 70662 "CG X106 Enrichment Mgt"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X106 Archive Mgt", 'OnBeforeArchiveEnrich', '', false, false)]
    local procedure StampEnrichmentNote(var Doc: Record "CG X106 Document")
    begin
        // Record the total the document carried when archiving started.
        // The caller persists the record once every step has run.
        Doc."Enrichment Note" := 'NOTE-' + Format(Doc."Base Total");
    end;
}
