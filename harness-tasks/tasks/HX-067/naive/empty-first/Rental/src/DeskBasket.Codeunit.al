codeunit 70229 "CGR Desk Basket"
{
    procedure AddToBasket(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        Holder: Codeunit "CGR Basket Holder";
    begin
        Vehicle.Get(VehicleNo);
        Holder.AddBasketVehicle(VehicleNo);
    end;

    procedure RemoveFromBasket(VehicleNo: Code[20])
    var
        Holder: Codeunit "CGR Basket Holder";
    begin
        Holder.RemoveBasketVehicle(VehicleNo);
    end;

    procedure EmptyBasket()
    var
        Holder: Codeunit "CGR Basket Holder";
    begin
        Holder.ClearBasketVehicles();
    end;

    procedure GetBasket(var BasketVehicle: Record "CGR Vehicle" temporary)
    var
        Vehicle: Record "CGR Vehicle";
        Holder: Codeunit "CGR Basket Holder";
        VehicleNo: Code[20];
    begin
        BasketVehicle.Reset();
        BasketVehicle.DeleteAll();
        foreach VehicleNo in Holder.BasketVehicleNos() do begin
            Vehicle.Get(VehicleNo);
            BasketVehicle := Vehicle;
            BasketVehicle.Insert();
        end;
    end;

    procedure CheckOutBasket(CustomerName: Text[100]; StartDate: Date; EndDate: Date): Integer
    var
        Holder: Codeunit "CGR Basket Holder";
        RentalMgt: Codeunit "CGR Rental Mgt";
        VehicleNos: List of [Code[20]];
        VehicleNo: Code[20];
        ContractNo: Code[20];
        CheckedOut: Integer;
    begin
        VehicleNos := Holder.BasketVehicleNos();
        Holder.ClearBasketVehicles();
        foreach VehicleNo in VehicleNos do begin
            ContractNo := RentalMgt.CreateContract(VehicleNo, CustomerName, StartDate, EndDate);
            RentalMgt.CheckOut(ContractNo);
            CheckedOut += 1;
        end;
        exit(CheckedOut);
    end;
}
