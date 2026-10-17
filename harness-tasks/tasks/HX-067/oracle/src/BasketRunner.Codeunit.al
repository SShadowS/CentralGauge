codeunit 86802 "HX067 Basket Runner"
{
    var
        RunAction: Option AddVehicle,CheckOut;
        VehicleNo: Code[20];
        CustomerName: Text[100];
        StartDate: Date;
        EndDate: Date;
        CheckedOutCount: Integer;

    procedure SetAdd(NewVehicleNo: Code[20])
    begin
        VehicleNo := NewVehicleNo;
        RunAction := RunAction::AddVehicle;
    end;

    procedure SetCheckOut(NewCustomerName: Text[100]; NewStartDate: Date; NewEndDate: Date)
    begin
        CustomerName := NewCustomerName;
        StartDate := NewStartDate;
        EndDate := NewEndDate;
        RunAction := RunAction::CheckOut;
    end;

    procedure HX67CheckedOutCount(): Integer
    begin
        exit(CheckedOutCount);
    end;

    trigger OnRun()
    var
        DeskBasket: Codeunit "CGR Desk Basket";
    begin
        CheckedOutCount := -1;
        case RunAction of
            RunAction::AddVehicle:
                DeskBasket.AddToBasket(VehicleNo);
            RunAction::CheckOut:
                CheckedOutCount := DeskBasket.CheckOutBasket(CustomerName, StartDate, EndDate);
        end;
    end;
}
