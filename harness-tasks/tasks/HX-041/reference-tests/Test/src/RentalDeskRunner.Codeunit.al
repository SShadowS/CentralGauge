codeunit 80085 "CGR Rental Desk Runner"
{
    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        if RunSwap then
            RentalMgt.SwapVehicle(RunContractNo, RunNewVehicleNo)
        else
            RentalMgt.Return(RunContractNo, RunReturnKm, RunDamageDescription);
    end;

    var
        RunContractNo: Code[20];
        RunNewVehicleNo: Code[20];
        RunReturnKm: Integer;
        RunDamageDescription: Text[100];
        RunSwap: Boolean;

    procedure SetSwap(ContractNo: Code[20]; NewVehicleNo: Code[20])
    begin
        RunSwap := true;
        RunContractNo := ContractNo;
        RunNewVehicleNo := NewVehicleNo;
    end;

    procedure SetReturn(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
        RunSwap := false;
        RunContractNo := ContractNo;
        RunReturnKm := ReturnKm;
        RunDamageDescription := DamageDescription;
    end;
}
