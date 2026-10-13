query 70514 "CGR Vehicle Utilisation"
{
    QueryType = Normal;

    elements
    {
        dataitem(Vehicle; "CGR Vehicle")
        {
            column(VehicleNo; "No.") { }
            dataitem(LedgerEntry; "CGR Rental Ledger Entry")
            {
                DataItemLink = "Vehicle No." = Vehicle."No.";
                column(Revenue; Amount) { Method = Sum; }
                column(Rentals) { Method = Count; }
            }
        }
    }
}
