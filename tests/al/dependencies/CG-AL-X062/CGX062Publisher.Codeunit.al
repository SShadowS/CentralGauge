codeunit 69007 "CG X062 Publisher"
{
    [IntegrationEvent(false, false)]
    procedure OnAudit(Step: Integer)
    begin
    end;

    [IntegrationEvent(false, false)]
    procedure OnNotify(Step: Integer)
    begin
    end;

    procedure Run(Step: Integer)
    begin
        OnAudit(Step);
        OnNotify(Step);
    end;
}
