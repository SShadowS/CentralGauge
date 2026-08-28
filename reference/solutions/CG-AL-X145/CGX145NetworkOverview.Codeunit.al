codeunit 71142 "CG X145 Network Overview"
{
    procedure GetLocationTotalQuantity(ItemNo: Code[20]; LocationCode: Code[10]): Decimal
    var
        Balance: Record "CG X139 Item Balance";
    begin
        if not Balance.Get(ItemNo, LocationCode) then
            exit(0);
        exit(Balance.Quantity);
    end;

    procedure GetNetworkTotalQuantity(ItemNo: Code[20]): Decimal
    var
        Balance: Record "CG X139 Item Balance";
        Total: Decimal;
    begin
        Balance.SetRange("Item No.", ItemNo);
        if Balance.FindSet() then
            repeat
                Total += Balance.Quantity;
            until Balance.Next() = 0;
        exit(Total);
    end;

    procedure FormatLocationQuantity(ItemNo: Code[20]; LocationCode: Code[10]; DisplayUnitCode: Code[10]): Text
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
        Rate: Decimal;
        Quantity: Decimal;
    begin
        Quantity := GetLocationTotalQuantity(ItemNo, LocationCode);
        Rate := Treasury.GetIntercompanyRate(DisplayUnitCode);
        if Rate <> 0 then
            Quantity := Quantity * Rate;
        exit(Format(Quantity));
    end;
}
