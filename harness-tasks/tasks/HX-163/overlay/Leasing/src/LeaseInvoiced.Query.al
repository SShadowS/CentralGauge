query 70374 "CGR Lease Invoiced"
{
    QueryType = Normal;

    elements
    {
        dataitem(Lease; "CGR Lease Contract")
        {
            column(LeaseNo; "No.") { }
            column(VehicleNo; "Vehicle No.") { }
            dataitem(Invoice; "CGR Lease Invoice")
            {
                // Default join: leases without invoices are kept, with zero sums.
                DataItemLink = "Contract No." = Lease."No.";
                column(InvoicedAmount; Amount) { Method = Sum; }
                column(Invoices) { Method = Count; }
                filter(InvoiceDateFilter; "Invoice Date") { }
            }
        }
    }
}
