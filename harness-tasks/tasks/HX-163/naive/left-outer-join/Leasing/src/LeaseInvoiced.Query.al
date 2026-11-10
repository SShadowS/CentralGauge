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
                DataItemLink = "Contract No." = Lease."No.";
                SqlJoinType = LeftOuterJoin;
                column(InvoicedAmount; Amount) { Method = Sum; }
                column(Invoices) { Method = Count; }
                filter(InvoiceDateFilter; "Invoice Date") { }
            }
        }
    }
}
