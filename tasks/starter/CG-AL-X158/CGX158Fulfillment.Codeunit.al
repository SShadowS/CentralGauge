codeunit 71422 "CG X158 Fulfillment"
{
    procedure CanFulfill(OrderLine: Record "CG X158 Order Line"): Boolean
    var
        Item: Record "CG X158 Item";
    begin
        Item.Get(OrderLine."Item No.");
        exit(OrderLine.Quantity <= Item."Qty on Hand (Base)");
    end;

    procedure Fulfill(OrderLine: Record "CG X158 Order Line")
    var
        Item: Record "CG X158 Item";
    begin
        Item.Get(OrderLine."Item No.");
        Item."Qty on Hand (Base)" -= Item.ToBaseQty(OrderLine.Quantity);
        Item.Modify();
    end;
}
