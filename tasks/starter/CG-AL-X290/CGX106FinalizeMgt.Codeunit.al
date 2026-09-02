codeunit 70663 "CG X106 Finalize Mgt"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X106 Archive Mgt", 'OnBeforeArchiveFinalize', '', false, false)]
    local procedure StampArchiveTag(var Doc: Record "CG X106 Document")
    begin
        // Re-read the document so this step always tags the record as it
        // currently stands, in case the caller handed us an older reference.
        Doc.Get(Doc."No.");
        if Doc."Base Total" >= 100 then
            Doc."Archive Tag" := 'PRIORITY'
        else
            Doc."Archive Tag" := 'STANDARD';
    end;
}
