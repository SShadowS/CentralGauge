query 70561 "CGR Vehicle Period Usage"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            column(Blocked; Blocked) { }
            dataitem(Ledger; "CGR Rental Ledger Entry")
            {
                // Default join: vehicles without ledger entries are kept, with zero sums.
                DataItemLink = "Vehicle No." = Vehicle."No.";
                column(Revenue; Amount) { Method = Sum; }
                column(KmDriven; "Km Driven") { Method = Sum; }
                column(Rentals) { Method = Count; }
                filter(PostingDateFilter; "Posting Date") { }
            }
        }
    }
}
