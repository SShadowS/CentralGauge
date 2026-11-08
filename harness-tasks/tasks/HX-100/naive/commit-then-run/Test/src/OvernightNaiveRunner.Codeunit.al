codeunit 80166 "CGR Overnight Naive Runner"
{
    var
        LeaseFilterText: Text;
        FailedLeases: List of [Code[20]];
        OvernightInvoiced: Integer;

    trigger OnRun()
    var
        Lease: Record "CGR Lease Contract";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
    begin
        Lease.SetFilter("No.", LeaseFilterText);
        OvernightInvoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);
    end;

    procedure SetLeaseFilter(NewLeaseFilter: Text)
    begin
        LeaseFilterText := NewLeaseFilter;
    end;

    procedure InvoicedLeases(): Integer
    begin
        exit(OvernightInvoiced);
    end;

    procedure FailedLeaseCount(): Integer
    begin
        exit(FailedLeases.Count());
    end;
}
