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
        Holder: Codeunit "CGR Basket Holder";
    begin
        Holder.ShareBasketVehicles(BasketVehicle);
    end;

    procedure CheckOutBasket(CustomerName: Text[100]; StartDate: Date; EndDate: Date): Integer
    var
        Holder: Codeunit "CGR Basket Holder";
        RentalMgt: Codeunit "CGR Rental Mgt";
        VehicleNo: Code[20];
        ContractNo: Code[20];
        CheckedOut: Integer;
    begin
        foreach VehicleNo in Holder.BasketVehicleNos() do begin
            ContractNo := RentalMgt.CreateContract(VehicleNo, CustomerName, StartDate, EndDate);
            RentalMgt.CheckOut(ContractNo);
            CheckedOut += 1;
        end;
        Holder.ClearBasketVehicles();
        exit(CheckedOut);
    end;
}
