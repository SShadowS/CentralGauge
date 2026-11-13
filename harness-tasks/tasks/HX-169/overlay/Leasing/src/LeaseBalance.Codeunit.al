codeunit 70388 "CGR Lease Balance"
{
    procedure OpenLeaseBalance(ContractNo: Code[20]): Decimal
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        exit(OpenLeaseBalanceFrom(ScheduleLine, ContractNo));
    end;

    procedure OpenLeaseBalanceFrom(var ScheduleLine: Record "CGR Lease Schedule Line"; ContractNo: Code[20]): Decimal
    var
        OpenBalance: Decimal;
    begin
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.SetRange(Invoiced, false);
        if ScheduleLine.FindSet() then
            repeat
                OpenBalance += ScheduleLine.Amount;
            until ScheduleLine.Next() = 0;
        OnAfterOpenLeaseBalance(ContractNo, OpenBalance);
        exit(OpenBalance);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterOpenLeaseBalance(ContractNo: Code[20]; OpenBalance: Decimal)
    begin
    end;
}
