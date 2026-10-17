codeunit 70233 "CGR Desk Swap"
{
    var
        NoSwapErr: Label 'There is no desk swap to undo.';

    procedure SwapAtDesk(ContractNo: Code[20]; NewVehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        SwapMemory: Codeunit "CGR Swap Memory";
        RentalMgt: Codeunit "CGR Rental Mgt";
        OldVehicleNo: Code[20];
    begin
        if Contract.Get(ContractNo) then
            OldVehicleNo := Contract."Vehicle No.";
        SwapMemory.RememberSwap(ContractNo, OldVehicleNo);
        RentalMgt.SwapVehicle(ContractNo, NewVehicleNo);
        OnAfterDeskSwap(ContractNo, OldVehicleNo, NewVehicleNo);
    end;

    procedure UndoLastSwap()
    var
        Contract: Record "CGR Rental Contract";
        SwapMemory: Codeunit "CGR Swap Memory";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        FromVehicleNo: Code[20];
        LeftVehicleNo: Code[20];
    begin
        if not SwapMemory.RecallSwap(ContractNo, FromVehicleNo) then
            Error(NoSwapErr);
        Contract.Get(ContractNo);
        LeftVehicleNo := Contract."Vehicle No.";
        RentalMgt.SwapVehicle(ContractNo, FromVehicleNo);
        OnAfterDeskSwap(ContractNo, LeftVehicleNo, FromVehicleNo);
        SwapMemory.ForgetSwap();
    end;

    procedure LastSwapContract(): Code[20]
    var
        SwapMemory: Codeunit "CGR Swap Memory";
        ContractNo: Code[20];
        FromVehicleNo: Code[20];
    begin
        SwapMemory.RecallSwap(ContractNo, FromVehicleNo);
        exit(ContractNo);
    end;

    procedure ForgetLastSwap()
    var
        SwapMemory: Codeunit "CGR Swap Memory";
    begin
        SwapMemory.ForgetSwap();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeskSwap(ContractNo: Code[20]; OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    begin
    end;
}
