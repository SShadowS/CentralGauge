codeunit 70230 "CGR Basket Holder"
{
    SingleInstance = true;

    var
        Basket: Record "CGR Vehicle" temporary;

    procedure AddBasketVehicle(VehicleNo: Code[20])
    begin
        Basket.Init();
        Basket."No." := VehicleNo;
        if Basket.Insert() then;
    end;

    procedure RemoveBasketVehicle(VehicleNo: Code[20])
    begin
        if Basket.Get(VehicleNo) then
            Basket.Delete();
    end;

    procedure ClearBasketVehicles()
    begin
        Basket.Reset();
        Basket.DeleteAll();
    end;

    procedure BasketVehicleNos() VehicleNos: List of [Code[20]]
    begin
        Basket.Reset();
        if Basket.FindSet() then
            repeat
                VehicleNos.Add(Basket."No.");
            until Basket.Next() = 0;
    end;
}
