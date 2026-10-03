query 70511 "CGR Revenue by Branch Month"
{
    QueryType = Normal;

    elements
    {
        dataitem(LedgerEntry; "CGR Rental Ledger Entry")
        {
            column(BranchCode; "Branch Code") { }
            column(PostingYear; "Posting Date") { Method = Year; }
            column(PostingMonth; "Posting Date") { Method = Month; }
            column(Amount; Amount) { Method = Sum; }
            column(EntryCount) { Method = Count; }
            filter(PostingDateFilter; "Posting Date") { }
        }
    }
}
