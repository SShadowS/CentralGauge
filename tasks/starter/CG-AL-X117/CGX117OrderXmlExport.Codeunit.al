codeunit 70772 "CG X117 Order Xml Export"
{
    procedure ExportOrder(OrderNo: Code[20]; var ExportedXml: Text)
    var
        Order: Record "CG X117 Sales Order";
        Doc: XmlDocument;
        Root: XmlElement;
        CustomerElement: XmlElement;
    begin
        Order.Get(OrderNo);

        Doc := XmlDocument.Create();
        Doc.SetDeclaration(XmlDeclaration.Create('1.0', 'UTF-8', 'no'));

        Root := XmlElement.Create('SalesOrder');
        Root.SetAttribute('no', Order."No.");
        Root.SetAttribute('customerNo', Order."Customer No.");
        Root.SetAttribute('orderDate', Format(Order."Order Date"));

        CustomerElement := XmlElement.Create('Customer');
        CustomerElement.Add(XmlElement.Create('Name', '', Order."Customer Name"));
        Root.Add(CustomerElement);

        Root.Add(BuildLines(Order));

        Doc.Add(Root);
        Doc.WriteTo(ExportedXml);
    end;

    local procedure BuildLines(Order: Record "CG X117 Sales Order"): XmlElement
    var
        OrderLine: Record "CG X117 Order Line";
        LinesElement: XmlElement;
        LineElement: XmlElement;
    begin
        LinesElement := XmlElement.Create('Lines');
        OrderLine.SetRange("Document No.", Order."No.");
        if OrderLine.FindSet() then
            repeat
                LineElement := XmlElement.Create('Line');
                LineElement.SetAttribute('lineNo', Format(OrderLine."Line No.", 0, 9));
                LineElement.SetAttribute('no', OrderLine."No.");
                LineElement.SetAttribute('description', OrderLine.Description);
                LineElement.SetAttribute('quantity', Format(OrderLine.Quantity, 0, 9));
                LineElement.SetAttribute('unitPrice', Format(OrderLine."Unit Price", 0, 9));
                LinesElement.Add(LineElement);
            until OrderLine.Next() = 0;
        exit(LinesElement);
    end;
}
