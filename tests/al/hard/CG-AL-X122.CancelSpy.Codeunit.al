codeunit 89350 "CG-AL-X122 Cancel Spy"
{
    // Oracle-side companion (see NOTES.md). An independently bound Manual
    // subscriber that counts OnDocumentCancelled hits without relying on the
    // application's own notifier - proves the event was actually raised even
    // when the application-side handler is rewritten to swallow it. Measured
    // (decisions entry 28): an application subscriber and this spy, each
    // bound separately, both fire for the same event, and unbinding one
    // does not affect the other.
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X122 Document Processor", 'OnDocumentCancelled', '', false, false)]
    local procedure OnCancelled(DocNo: Code[20])
    begin
        HitCount += 1;
    end;

    procedure CancelCount(): Integer
    begin
        exit(HitCount);
    end;

    var
        HitCount: Integer;
}
