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
