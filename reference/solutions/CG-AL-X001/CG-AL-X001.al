codeunit 70900 "CG X001 Worker"
{
    Access = Internal;

    procedure RunAudited()
    var
        Publisher: Codeunit "CG X001 Publisher";
        AuditSub: Codeunit "CG X001 Audit Sub";
    begin
        BindSubscription(AuditSub);
        Publisher.Raise();
        UnbindSubscription(AuditSub);
    end;
}