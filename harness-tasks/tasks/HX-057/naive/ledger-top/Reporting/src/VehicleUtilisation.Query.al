query 70514 "CGR Vehicle Utilisation"
{
    QueryType = Normal;

    elements
    {
        dataitem(LedgerEntry; "CGR Rental Ledger Entry")
        {
            column(VehicleNo; "Vehicle No.") { }
            column(Revenue; Amount) { Method = Sum; }
            column(Rentals) { Method = Count; }
            dataitem(Vehicle; "CGR Vehicle")
            {
                DataItemLink = "No." = LedgerEntry."Vehicle No.";
            }
        }
    }
}
