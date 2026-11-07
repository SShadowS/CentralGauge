codeunit 80162 "CGR Overnight Billing Runner"
{
    var
        LeaseFilterText: Text;
        RenamedLeaseNo: Code[20];
        NewCustomerName: Text[100];
        FailedLeases: List of [Code[20]];
        OvernightInvoiced: Integer;

    trigger OnRun()
    var
        Lease: Record "CGR Lease Contract";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
    begin
        if RenamedLeaseNo <> '' then begin
            Lease.Get(RenamedLeaseNo);
            Lease."Customer Name" := NewCustomerName;
            Lease.Modify();
        end;
        Lease.Reset();
        Lease.SetFilter("No.", LeaseFilterText);
        OvernightInvoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);
    end;

    procedure SetOvernightBilling(NewLeaseFilter: Text; LeaseNoToRename: Code[20]; CustomerName: Text[100])
    begin
        LeaseFilterText := NewLeaseFilter;
        RenamedLeaseNo := LeaseNoToRename;
        NewCustomerName := CustomerName;
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
