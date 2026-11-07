codeunit 70346 "CGR Lease Desk Scope"
{
    procedure ScopeToStartPeriod(var Lease: Record "CGR Lease Contract"; FromDate: Date; ToDate: Date)
    begin
        Lease.FilterGroup(2);
        Lease.SetRange("Start Date", FromDate, ToDate);
        Lease.FilterGroup(0);
    end;
}
