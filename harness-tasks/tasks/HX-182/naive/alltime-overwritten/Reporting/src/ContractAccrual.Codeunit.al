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

    procedure PostedRevenueBetween(FromDate: Date; ToDate: Date): Dictionary of [Code[20], Decimal]
    var
        PostedRevenueQuery: Query "CGR Contract Posted Revenue";
        Result: Dictionary of [Code[20], Decimal];
    begin
        // Every contract is a key in the all-time figures; the period read then replaces the amounts.
        Result := PostedRevenue();
        PostedRevenueQuery.SetRange(PostingDateFilter, FromDate, ToDate);
        PostedRevenueQuery.Open();
        while PostedRevenueQuery.Read() do
            Result.Set(PostedRevenueQuery.ContractNo, PostedRevenueQuery.PostedAmount);
        PostedRevenueQuery.Close();
        exit(Result);
    end;
}
