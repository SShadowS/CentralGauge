codeunit 70416 "CGR Event Transport" implements "CGR Outbox Transport"
{
    procedure Send(Entry: Record "CGR Outbox Entry"): Boolean
    var
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
    begin
        exit(Dispatcher.RaiseSendEntry(Entry));
    end;
}
