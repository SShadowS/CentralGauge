codeunit 70323 "CGR Lease Rate Change"
{
    var
        RateNotPositiveErr: Label 'Lease %1 needs a base rate above zero.', Comment = '%1 = lease number';

    procedure ChangeBaseRate(ContractNo: Code[20]; NewBaseRate: Decimal): Integer
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Repriced: Integer;
    begin
        if NewBaseRate <= 0 then
            Error(RateNotPositiveErr, ContractNo);
        Contract.Get(ContractNo);
        RaiseBeforeChangeBaseRate(ContractNo, Contract."Base Rate", NewBaseRate);

        Contract."Base Rate" := NewBaseRate;
        Contract.Modify(true);

        Line.SetRange("Contract No.", ContractNo);
        if Line.FindSet(true) then
            repeat
                if not Line.Invoiced then
                    Repriced += 1;
                Line.Amount := LeaseMgt.MonthlyRate(NewBaseRate, Contract.Months);
                Line.Modify(true);
            until Line.Next() = 0;
        exit(Repriced);
    end;

    [CommitBehavior(CommitBehavior::Error)]
    local procedure RaiseBeforeChangeBaseRate(ContractNo: Code[20]; OldBaseRate: Decimal; NewBaseRate: Decimal)
    begin
        OnBeforeChangeBaseRate(ContractNo, OldBaseRate, NewBaseRate);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeChangeBaseRate(ContractNo: Code[20]; OldBaseRate: Decimal; NewBaseRate: Decimal)
    begin
    end;
}
