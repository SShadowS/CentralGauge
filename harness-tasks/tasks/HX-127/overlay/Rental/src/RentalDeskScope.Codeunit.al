codeunit 70246 "CGR Rental Desk Scope"
{
    procedure ScopeToBranch(var Contract: Record "CGR Rental Contract"; BranchCode: Code[10])
    begin
        Contract.FilterGroup(2);
        Contract.SetRange("Branch Code", BranchCode);
        Contract.FilterGroup(0);
    end;
}
