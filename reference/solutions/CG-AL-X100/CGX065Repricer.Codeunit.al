codeunit 70201 "CG X065 Repricer"
{
    procedure RepriceCategory(Category: Code[10])
    var
        Line: Record "CG X065 Order Line";
        PriceSvc: Codeunit "CG X065 Price Svc";
        Price: Integer;
    begin
        Line.SetRange(Category, Category);
        if Line.FindSet(true) then
            repeat
                Price := PriceSvc.UnitPriceFor(Line);
                Line."Line Total" := Line.Quantity * Price;
                Line.Modify();
            until Line.Next() = 0;
    end;
}
