codeunit 70471 "CGR Redelivery Send"
{
    TableNo = "CGR Outbox Entry";

    trigger OnRun()
    begin
        OnRedeliverEntry(Rec);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnRedeliverEntry(Entry: Record "CGR Outbox Entry")
    begin
    end;
}
