codeunit 80153 "CGR Lease Night Run Runner"
{
    var
        LeaseFilterText: Text;
        RenamedLeaseNo: Code[20];
        NewCustomerName: Text[100];
        FailedLeases: List of [Code[20]];
        NightRunInvoiced: Integer;

    trigger OnRun()
    var
        Lease: Record "CGR Lease Contract";
        NightRun: Codeunit "CGR Lease Night Run";
    begin
        if RenamedLeaseNo <> '' then begin
            Lease.Get(RenamedLeaseNo);
            Lease."Customer Name" := NewCustomerName;
            Lease.Modify();
        end;
        Lease.Reset();
        Lease.SetFilter("No.", LeaseFilterText);
        NightRunInvoiced := NightRun.InvoiceNightRun(Lease, FailedLeases);
    end;

    procedure SetNightRun(NewLeaseFilter: Text; LeaseNoToRename: Code[20]; CustomerName: Text[100])
    begin
        LeaseFilterText := NewLeaseFilter;
        RenamedLeaseNo := LeaseNoToRename;
        NewCustomerName := CustomerName;
    end;

    procedure InvoicedLeases(): Integer
    begin
        exit(NightRunInvoiced);
    end;

    procedure FailedLeaseCount(): Integer
    begin
        exit(FailedLeases.Count());
    end;
}
