codeunit 86942 "HX074 Desk Runner"
{
    var
        RunAction: Option VehicleCheck,ContractCheckOut,ContractSwap;
        VehicleNo: Code[20];
        ContractNo: Code[20];

    procedure HX74SetVehicleCheck(NewVehicleNo: Code[20])
    begin
        VehicleNo := NewVehicleNo;
        RunAction := RunAction::VehicleCheck;
    end;

    procedure HX74SetCheckOut(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
        RunAction := RunAction::ContractCheckOut;
    end;

    procedure HX74SetSwap(NewContractNo: Code[20]; NewVehicleNo: Code[20])
    begin
        ContractNo := NewContractNo;
        VehicleNo := NewVehicleNo;
        RunAction := RunAction::ContractSwap;
    end;

    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        case RunAction of
            RunAction::VehicleCheck:
                RentalMgt.CheckVehicleAvailable(VehicleNo);
            RunAction::ContractCheckOut:
                RentalMgt.CheckOut(ContractNo);
            RunAction::ContractSwap:
                RentalMgt.SwapVehicle(ContractNo, VehicleNo);
        end;
    end;
}
