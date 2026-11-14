codeunit 70597 "CGR Contract Accrual"
{
    procedure PostedRevenue(): Dictionary of [Code[20], Decimal]
    var
        PostedRevenueQuery: Query "CGR Contract Posted Revenue";
        Result: Dictionary of [Code[20], Decimal];
    begin
        PostedRevenueQuery.Open();
        while PostedRevenueQuery.Read() do
            Result.Add(PostedRevenueQuery.ContractNo, PostedRevenueQuery.PostedAmount);
        PostedRevenueQuery.Close();
        exit(Result);
    end;
}
