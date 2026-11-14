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
        RentalContract: Record "CGR Rental Contract";
        LedgerEntry: Record "CGR Rental Ledger Entry";
        Result: Dictionary of [Code[20], Decimal];
    begin
        LedgerEntry.SetCurrentKey("Contract No.");
        LedgerEntry.SetRange("Posting Date", FromDate, ToDate);
        if RentalContract.FindSet() then
            repeat
                LedgerEntry.SetRange("Contract No.", RentalContract."No.");
                LedgerEntry.CalcSums(Amount);
                Result.Add(RentalContract."No.", LedgerEntry.Amount);
            until RentalContract.Next() = 0;
        exit(Result);
    end;
}
