codeunit 70520 "CG H052 Tenant Scope"
{
    Access = Public;

    procedure ApplyTenantScope(var Acct: Record "CG H052 Account"; TenantId: Code[20])
    begin
        Acct.FilterGroup(2);
        Acct.SetRange("Tenant Id", TenantId);
        Acct.FilterGroup(0);
    end;
}