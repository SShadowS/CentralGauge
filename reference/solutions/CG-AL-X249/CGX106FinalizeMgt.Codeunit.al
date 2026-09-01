codeunit 70663 "CG X106 Finalize Mgt"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X106 Archive Mgt", 'OnBeforeArchiveFinalize', '', false, false)]
    local procedure StampArchiveTag(var Doc: Record "CG X106 Document")
    var
        Fresh: Record "CG X106 Document";
    begin
        // Read the document through a separate instance so double-checking
        // it cannot discard whatever the caller has already stamped onto Doc.
        Fresh.Get(Doc."No.");
        if Fresh."Base Total" >= 100 then
            Doc."Archive Tag" := 'PRIORITY'
        else
            Doc."Archive Tag" := 'STANDARD';
    end;
}
