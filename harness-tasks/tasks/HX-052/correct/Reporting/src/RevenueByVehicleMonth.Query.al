query 70510 "CGR Revenue by Vehicle Month"
{
    QueryType = Normal;

    elements
    {
        dataitem(LedgerEntry; "CGR Rental Ledger Entry")
        {
            column(VehicleNo; "Vehicle No.") { }
            column(PostingYear; "Posting Date") { Method = Year; }
            column(PostingMonth; "Posting Date") { Method = Month; }
            column(Amount; Amount) { Method = Sum; }
            column(EntryCount) { Method = Count; }
        }
    }
}
