codeunit 70229 "CGR Desk Basket"
{
    var
        Basket: Record "CGR Vehicle" temporary;

    procedure AddToBasket(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Basket.Init();
        Basket."No." := VehicleNo;
        if Basket.Insert() then;
    end;

    procedure RemoveFromBasket(VehicleNo: Code[20])
    begin
        if Basket.Get(VehicleNo) then
            Basket.Delete();
    end;

    procedure EmptyBasket()
    begin
        Basket.Reset();
        Basket.DeleteAll();
    end;

    procedure GetBasket(var BasketVehicle: Record "CGR Vehicle" temporary)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        BasketVehicle.Reset();
        BasketVehicle.DeleteAll();
        Basket.Reset();
        if Basket.FindSet() then
            repeat
                Vehicle.Get(Basket."No.");
                BasketVehicle := Vehicle;
                BasketVehicle.Insert();
            until Basket.Next() = 0;
    end;

    procedure CheckOutBasket(CustomerName: Text[100]; StartDate: Date; EndDate: Date): Integer
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        CheckedOut: Integer;
    begin
        Basket.Reset();
        if Basket.FindSet() then
            repeat
                ContractNo := RentalMgt.CreateContract(Basket."No.", CustomerName, StartDate, EndDate);
                RentalMgt.CheckOut(ContractNo);
                CheckedOut += 1;
            until Basket.Next() = 0;
        Basket.DeleteAll();
        exit(CheckedOut);
    end;
}
