// Manually-bound integration-event witness: proves whether posting or
// editing a document actually reaches the table's own modify trigger and
// publishes OnAfterModifyEvent, the seam any real downstream integration
// (an audit trail, a notification, a sync) would hook into. It is bound and
// unbound around a single test only, so it never observes writes made by
// any other test in this suite.
codeunit 89197 "CG-AL-X095 Modify Observer"
{
    EventSubscriberInstance = Manual;

    var
        ObservedDocNos: List of [Code[20]];

    [EventSubscriber(ObjectType::Table, Database::"CG X095 Document", 'OnAfterModifyEvent', '', false, false)]
    local procedure OnAfterDocumentModify(var Rec: Record "CG X095 Document"; var xRec: Record "CG X095 Document"; RunTrigger: Boolean)
    begin
        if not ObservedDocNos.Contains(Rec."No.") then
            ObservedDocNos.Add(Rec."No.");
    end;

    procedure HasObserved(No: Code[20]): Boolean
    begin
        exit(ObservedDocNos.Contains(No));
    end;
}
