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
        InPeriodQuery: Query "CGR Contract Posted Revenue";
        EveryContractQuery: Query "CGR Contract Posted Revenue";
        Result: Dictionary of [Code[20], Decimal];
    begin
        InPeriodQuery.SetRange(PostingDateFilter, FromDate, ToDate);
        InPeriodQuery.Open();
        while InPeriodQuery.Read() do
            Result.Add(InPeriodQuery.ContractNo, InPeriodQuery.PostedAmount);
        InPeriodQuery.Close();

        // Contracts that were never posted come back from the unfiltered query with no postings.
        EveryContractQuery.Open();
        while EveryContractQuery.Read() do
            if (EveryContractQuery.Postings = 0) and not Result.ContainsKey(EveryContractQuery.ContractNo) then
                Result.Add(EveryContractQuery.ContractNo, 0);
        EveryContractQuery.Close();
        exit(Result);
    end;
}
