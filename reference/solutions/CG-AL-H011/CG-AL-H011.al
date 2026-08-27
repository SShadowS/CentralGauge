namespace CG.Sales;

using Microsoft.Sales.Document;

query 70011 "CG Sales Summary"
{
    QueryType = Normal;
    Caption = 'CG Sales Summary';
    OrderBy = ascending(Sell_to_Customer_No);

    elements
    {
        dataitem(Sales_Line; "Sales Line")
        {
            column(Document_No; "Document No.")
            {
            }
            column(Sell_to_Customer_No; "Sell-to Customer No.")
            {
            }
            column(Line_Amount_Sum; "Line Amount")
            {
                Method = Sum;
            }
            column(Line_Count)
            {
                Method = Count;
            }
            filter(Document_Type; "Document Type")
            {
                ColumnFilter = Document_Type = const(Order);
            }
        }
    }
}