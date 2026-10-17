codeunit 70233 "CGR Desk Swap"
{
    var
        LastContractNo: Code[20];
        LastFromVehicleNo: Code[20];
        NoSwapErr: Label 'There is no desk swap to undo.';

    procedure SwapAtDesk(ContractNo: Code[20]; NewVehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        OldVehicleNo: Code[20];
    begin
        Contract.Get(ContractNo);
        OldVehicleNo := Contract."Vehicle No.";
        RentalMgt.SwapVehicle(ContractNo, NewVehicleNo);
        OnAfterDeskSwap(ContractNo, OldVehicleNo, NewVehicleNo);
        LastContractNo := ContractNo;
        LastFromVehicleNo := OldVehicleNo;
    end;

    procedure UndoLastSwap()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        LeftVehicleNo: Code[20];
    begin
        if LastContractNo = '' then
            Error(NoSwapErr);
        Contract.Get(LastContractNo);
        LeftVehicleNo := Contract."Vehicle No.";
        RentalMgt.SwapVehicle(LastContractNo, LastFromVehicleNo);
        OnAfterDeskSwap(LastContractNo, LeftVehicleNo, LastFromVehicleNo);
        Clear(LastContractNo);
        Clear(LastFromVehicleNo);
    end;

    procedure LastSwapContract(): Code[20]
    begin
        exit(LastContractNo);
    end;

    procedure ForgetLastSwap()
    begin
        Clear(LastContractNo);
        Clear(LastFromVehicleNo);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeskSwap(ContractNo: Code[20]; OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    begin
    end;
}
