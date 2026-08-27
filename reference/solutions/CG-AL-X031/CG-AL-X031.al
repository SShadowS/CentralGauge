codeunit 71200 "CG X031 Pricer"
{
    Access = Internal;

    procedure TotalPrice(ItemNos: List of [Code[20]]): Integer
    var
        CGX031Item: Record "CG X031 Item";
        ItemNo: Code[20];
        Total: Integer;
    begin
        Total := 0;
        foreach ItemNo in ItemNos do
            if CGX031Item.Get(ItemNo) then
                Total += CGX031Item.Price;
        exit(Total);
    end;
}