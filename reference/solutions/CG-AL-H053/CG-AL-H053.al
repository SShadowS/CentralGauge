query 70530 "CG H053 Cust Total Q"
{
    Caption = 'CG H053 Cust Total Q';
    QueryType = Normal;

    elements
    {
        dataitem(SaleLine; "CG H053 Sale")
        {
            column(Customer_No; "Customer No.")
            {
            }
            column(Total_Amount; Amount)
            {
                Method = Sum;
            }
        }
    }
}

codeunit 70531 "CG H053 Stats"
{
    procedure TotalForCustomer(CustNo: Code[20]) Total: Decimal
    var
        CustTotalQuery: Query "CG H053 Cust Total Q";
    begin
        Total := 0;
        CustTotalQuery.SetRange(Customer_No, CustNo);
        CustTotalQuery.Open();
        if CustTotalQuery.Read() then
            Total := CustTotalQuery.Total_Amount;
        CustTotalQuery.Close();
    end;
}