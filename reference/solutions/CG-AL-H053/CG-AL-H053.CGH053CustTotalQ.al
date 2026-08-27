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
