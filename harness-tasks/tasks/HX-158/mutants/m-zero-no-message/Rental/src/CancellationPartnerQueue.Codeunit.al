codeunit 70284 "CGR Cancellation Partner Queue"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Cancellation Run", 'OnAfterCancellationWritten', '', false, false)]
    local procedure QueueCancellationNotice(Entry: Record "CGR Cancellation Entry")
    var
        Notice: Record "CGR Cancellation Message";
    begin
        if Entry."Fee Amount" = 0 then
            exit;
        Notice.Init();
        Notice."Contract No." := Entry."Contract No.";
        Notice."Fee Amount" := Entry."Fee Amount";
        Notice.Insert(true);
    end;
}
