codeunit 70404 "CGR Integration Silencer"
{
    EventSubscriberInstance = Manual;

    var
        SilenceState: Codeunit "CGR Silence State";

    procedure IsSilenced(): Boolean
    begin
        exit(SilenceState.SilencedNow());
    end;

    procedure SilenceMessages()
    begin
        SilenceState.SetSilenced(true);
    end;

    procedure ResumeMessages()
    begin
        SilenceState.SetSilenced(false);
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Rental Contract", 'OnBeforeModifyEvent', '', false, false)]
    local procedure AnnounceQuietSave(var Rec: Record "CGR Rental Contract"; var xRec: Record "CGR Rental Contract"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        OnBeforeQuietContractSave(Rec);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeQuietContractSave(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
