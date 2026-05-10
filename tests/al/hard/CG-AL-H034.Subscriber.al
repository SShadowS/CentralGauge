codeunit 80234 "CG-AL-H034 Subscriber"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG H034 Engine", 'OnBeforeFinalize', '', true, true)]
    local procedure OnBeforeFinalize_AttemptsCommit(var Item: Record "CG H034 Item")
    begin
        // Subscriber code (typically third-party). Calls Commit() to attempt to
        // persist the publisher's pre-event writes. The publisher MUST suppress
        // this Commit via [CommitBehavior(CommitBehavior::Ignore)].
        Commit();
    end;
}
