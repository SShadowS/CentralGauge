codeunit 70294 "CGR Contract Notifier"
{
    procedure Queue(EventType: Text[30]; Payload: Code[20])
    var
        Notification: Record "CGR Partner Notification";
    begin
        Notification.Init();
        Notification."Event Type" := EventType;
        Notification.Payload := Payload;
        Notification."Created At" := CurrentDateTime();
        Notification.Insert(true);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Rental Contract", 'OnAfterModifyEvent', '', false, false)]
    local procedure QueueContractChangedOnModify(var Rec: Record "CGR Rental Contract"; var xRec: Record "CGR Rental Contract"; RunTrigger: Boolean)
    var
        Skip: Boolean;
    begin
        if Rec.IsTemporary() then
            exit;
        OnBeforeQueueContractChanged(Skip);
        if not Skip then
            Queue('contractChanged', Rec."No.");
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeQueueContractChanged(var Skip: Boolean)
    begin
    end;
}
