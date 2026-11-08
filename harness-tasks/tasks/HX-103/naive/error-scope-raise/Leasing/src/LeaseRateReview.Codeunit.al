codeunit 70350 "CGR Lease Rate Review"
{
    var
        DeclinedErr: Label 'The proposed rate for lease %1 is declined.', Comment = '%1 = lease number';

    procedure ReviewLeaseRates(var LeaseFilter: Record "CGR Lease Contract"): Integer
    var
        Lease: Record "CGR Lease Contract";
        LeaseNos: List of [Code[20]];
        LeaseNo: Code[20];
        Changed: Integer;
    begin
        Lease.CopyFilters(LeaseFilter);
        if Lease.FindSet() then
            repeat
                LeaseNos.Add(Lease."No.");
            until Lease.Next() = 0;
        foreach LeaseNo in LeaseNos do begin
            Lease.Get(LeaseNo);
            Commit();
            if Codeunit.Run(Codeunit::"CGR Lease Rate Review Unit", Lease) then
                Changed += 1;
        end;
        exit(Changed);
    end;

    internal procedure ReviewLease(LeaseNo: Code[20])
    var
        Lease: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ProposedRate: Decimal;
    begin
        Lease.Get(LeaseNo);
        ProposedRate := ProposeRate(Lease);
        if not IsAcceptable(Lease."Base Rate", ProposedRate) then
            Error(DeclinedErr, LeaseNo);
        Lease.Get(LeaseNo);
        Lease."Base Rate" := ProposedRate;
        Lease.Modify(true);
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    [CommitBehavior(CommitBehavior::Error)]
    local procedure ProposeRate(Lease: Record "CGR Lease Contract"): Decimal
    var
        ProposedRate: Decimal;
    begin
        OnProposeLeaseRate(Lease, ProposedRate);
        exit(ProposedRate);
    end;

    local procedure IsAcceptable(BaseRate: Decimal; ProposedRate: Decimal): Boolean
    begin
        if ProposedRate <= 0 then
            exit(false);
        exit(Abs(ProposedRate - BaseRate) <= BaseRate * 10 / 100);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnProposeLeaseRate(LeaseContract: Record "CGR Lease Contract"; var ProposedRate: Decimal)
    begin
    end;
}
