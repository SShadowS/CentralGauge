codeunit 70295 "CGR Rerating"
{
    procedure RerateBranch(BranchCode: Code[10]; Factor: Decimal): Integer
    var
        Pause: Codeunit "CGR Notify Pause";
        Changed: Integer;
    begin
        BindSubscription(Pause);
        Changed := RerateContracts(BranchCode, Factor);
        UnbindSubscription(Pause);
        QueueRatesChanged(BranchCode);
        exit(Changed);
    end;

    procedure RerateAll(Factor: Decimal) Changed: Integer
    var
        Branch: Record "CGR Branch";
    begin
        PauseNotifications();
        if Branch.FindSet() then
            repeat
                Changed += RerateContracts(Branch.Code, Factor);
                QueueRatesChanged(Branch.Code);
            until Branch.Next() = 0;
    end;

    local procedure PauseNotifications()
    var
        Pause: Codeunit "CGR Notify Pause";
    begin
        BindSubscription(Pause);                         // stays bound for the night job
    end;

    local procedure RerateContracts(BranchCode: Code[10]; Factor: Decimal) Changed: Integer
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
    begin
        Contract.SetRange(Status, Contract.Status::Open);
        Contract.SetRange("Branch Code", BranchCode);
        if Contract.FindSet(true) then
            repeat
                Vehicle.Get(Contract."Vehicle No.");
                Contract."Agreed Daily Rate" := Round(Vehicle."Daily Rate" * Factor, 1);
                Contract.Modify(true);
                Changed += 1;
            until Contract.Next() = 0;
    end;

    local procedure QueueRatesChanged(BranchCode: Code[10])
    var
        Notifier: Codeunit "CGR Contract Notifier";
    begin
        Notifier.Queue('ratesChanged', BranchCode);
    end;
}
