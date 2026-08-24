codeunit 71490 "CG X062 Listener"
{
    EventSubscriberInstance = Manual;

    var
        AuditEnabled: Boolean;
        NotifyEnabled: Boolean;
        Audits: Integer;
        Notifies: Integer;

    procedure ListenToAuditOnly()
    begin
        AuditEnabled := true;
        NotifyEnabled := false;
    end;

    procedure ListenToBoth()
    begin
        AuditEnabled := true;
        NotifyEnabled := true;
    end;

    procedure AuditCount(): Integer
    begin
        exit(Audits);
    end;

    procedure NotifyCount(): Integer
    begin
        exit(Notifies);
    end;

    // Binding is per codeunit INSTANCE, so both subscribers go live together.
    // Each therefore needs its own gate flag.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X062 Publisher", 'OnAudit', '', false, false)]
    local procedure HandleAudit(Step: Integer)
    begin
        if AuditEnabled then
            Audits += 1;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X062 Publisher", 'OnNotify', '', false, false)]
    local procedure HandleNotify(Step: Integer)
    begin
        if NotifyEnabled then
            Notifies += 1;
    end;
}
