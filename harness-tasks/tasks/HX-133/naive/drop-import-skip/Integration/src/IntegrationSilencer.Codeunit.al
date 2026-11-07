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

    [IntegrationEvent(false, false)]
    local procedure OnBeforeQuietContractSave(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
