codeunit 70582 "CG X093 Order Export"
{
    procedure ExportOrder(Order: Record "CG X093 Order"): Text
    var
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        LinesArray: JsonArray;
        Payload: Text;
    begin
        OrderObject.Add('orderNo', Order."No.");
        OrderObject.Add('customerNo', Order."Customer No.");
        OrderObject.Add('orderDate', Format(Order."Order Date"));

        OrderLine.SetRange("Order No.", Order."No.");
        if OrderLine.FindSet() then
            repeat
                LinesArray.Add(BuildLine(OrderLine));
            until OrderLine.Next() = 0;
        OrderObject.Add('lines', LinesArray);

        OrderObject.WriteTo(Payload);
        exit(Payload);
    end;

    local procedure BuildLine(OrderLine: Record "CG X093 Order Line") LineObject: JsonObject
    var
        FormattedUnitPrice: Text;
    begin
        LineObject.Add('lineNo', OrderLine."Line No.");
        LineObject.Add('itemNo', OrderLine."Item No.");
        LineObject.Add('description', OrderLine.Description);
        LineObject.Add('quantity', OrderLine.Quantity);
        FormattedUnitPrice := Format(OrderLine."Unit Price");
        LineObject.Add('unitPrice', FormattedUnitPrice);
        LineObject.Add('lineAmount', OrderLine."Line Amount");
    end;
}
