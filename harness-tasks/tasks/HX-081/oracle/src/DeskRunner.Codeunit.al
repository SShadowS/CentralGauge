// Runs one desk action through a fresh CGR Desk Swap variable, so a raising call is observed as Ok false.
codeunit 87082 "HX081 Desk Runner"
{
    var
        ContractNo: Code[20];
        NewVehicleNo: Code[20];
        RunAction: Option Forget,Swap,Undo;

    procedure HX81SetSwap(NewContractNo: Code[20]; VehicleNo: Code[20])
    begin
        ContractNo := NewContractNo;
        NewVehicleNo := VehicleNo;
        RunAction := RunAction::Swap;
    end;

    procedure HX81SetUndo()
    begin
        RunAction := RunAction::Undo;
    end;

    procedure HX81SetForget()
    begin
        RunAction := RunAction::Forget;
    end;

    trigger OnRun()
    var
        DeskSwap: Codeunit "CGR Desk Swap";
    begin
        case RunAction of
            RunAction::Forget:
                DeskSwap.ForgetLastSwap();
            RunAction::Swap:
                DeskSwap.SwapAtDesk(ContractNo, NewVehicleNo);
            RunAction::Undo:
                DeskSwap.UndoLastSwap();
        end;
    end;
}
