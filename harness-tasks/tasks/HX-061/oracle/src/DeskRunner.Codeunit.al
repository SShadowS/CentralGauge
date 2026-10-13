codeunit 86681 "HX061 Desk Runner"
{
    var
        VehicleNos: List of [Code[20]];
        ContractNo: Code[20];
        RunAction: Option EndInspection,StartInspection,CheckOut,CheckOutForInspection;

    procedure SetEnd()
    begin
        RunAction := RunAction::EndInspection;
    end;

    procedure SetStart(NewVehicleNos: List of [Code[20]])
    begin
        VehicleNos := NewVehicleNos;
        RunAction := RunAction::StartInspection;
    end;

    procedure SetCheckOut(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
        RunAction := RunAction::CheckOut;
    end;

    procedure SetCheckOutForInspection(NewContractNo: Code[20])
    begin
        ContractNo := NewContractNo;
        RunAction := RunAction::CheckOutForInspection;
    end;

    trigger OnRun()
    var
        DeskInspection: Codeunit "CGR Desk Inspection";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        case RunAction of
            RunAction::EndInspection:
                DeskInspection.EndInspection();
            RunAction::StartInspection:
                DeskInspection.StartInspection(VehicleNos);
            RunAction::CheckOut:
                RentalMgt.CheckOut(ContractNo);
            RunAction::CheckOutForInspection:
                DeskInspection.CheckOutForInspection(ContractNo);
        end;
    end;
}
