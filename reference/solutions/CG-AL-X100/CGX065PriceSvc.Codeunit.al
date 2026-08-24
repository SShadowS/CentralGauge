codeunit 70202 "CG X065 Price Svc"
{
    procedure UnitPriceFor(var Line: Record "CG X065 Order Line"): Integer
    var
        Sibling: Record "CG X065 Order Line";
        CategoryQty: Integer;
        Price: Integer;
    begin
        Price := BasePriceOf(Line.Category);

        // Volume discount: categories moving 20 units or more get 2 off.
        // Aggregated over a LOCAL record so the caller's filters and
        // position on Line stay untouched.
        CategoryQty := 0;
        Sibling.SetRange(Category, Line.Category);
        if Sibling.FindSet() then
            repeat
                CategoryQty += Sibling.Quantity;
            until Sibling.Next() = 0;

        if CategoryQty >= 20 then
            exit(Price - 2);
        exit(Price);
    end;

    local procedure BasePriceOf(Category: Code[10]): Integer
    begin
        case Category of
            'ALPHA':
                exit(10);
            'BETA':
                exit(7);
        end;
        exit(5);
    end;
}
