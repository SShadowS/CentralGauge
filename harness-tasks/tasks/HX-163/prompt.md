# Bug 5163: Lease balance list stops with "already exists"

Reported by Collections.

The collections team works from the lease balance list (`CGR Lease Balance`.`FillBalances`). Since a customer leased a second car under a new lease on the same vehicle (after the first lease was bought out), the list stops with "The record in table CGR Lease Balance Buffer already exists".

Expected (unchanged from the original request):

- One buffer row per lease contract, with the lease's vehicle, the amount invoiced up to AsOf (sum of the lease's `CGR Lease Invoice` amounts with "Invoice Date" on or before AsOf) and the number of those invoices.
- Leases with nothing invoiced up to AsOf (new leases, leases on a payment holiday) are listed with 0: collections calls exactly those customers first.
- Several leases can exist for one vehicle over time.

Shipped code:

```al
// Leasing
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

codeunit 70375 "CGR Lease Balance"
{
    procedure FillBalances(AsOf: Date; var Buffer: Record "CGR Lease Balance Buffer" temporary)
    var
        LeaseInvoiced: Query "CGR Lease Invoiced";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        LeaseInvoiced.SetFilter(InvoiceDateFilter, '..%1', AsOf);
        LeaseInvoiced.Open();
        while LeaseInvoiced.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := LeaseInvoiced.VehicleNo;
            Buffer."Lease No." := LeaseInvoiced.LeaseNo;
            Buffer."Invoiced Amount" := LeaseInvoiced.InvoicedAmount;
            Buffer.Invoices := LeaseInvoiced.Invoices;
            Buffer.Insert();
        end;
        LeaseInvoiced.Close();
    end;
}

// CGR Lease Balance Buffer (used as temporary only): "Vehicle No." (Code[20], primary key), "Lease No." (Code[20]),
// "Invoiced Amount" (Decimal), Invoices (Integer).
// CGR Lease Invoice: "Entry No." (AutoIncrement), "Contract No.", "Line No.", "Invoice Date", Amount.
// CGR Lease Contract: "No.", "Vehicle No.", "Customer Name", "Start Date", Months, "Base Rate".
```

Write the corrected AL for the affected objects and explain briefly.
