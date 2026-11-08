codeunit 70296 "CGR Notify Pause"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Contract Notifier", 'OnBeforeQueueContractChanged', '', false, false)]
    local procedure SkipWhilePaused(var Skip: Boolean)
    begin
        Skip := true;
    end;
}
