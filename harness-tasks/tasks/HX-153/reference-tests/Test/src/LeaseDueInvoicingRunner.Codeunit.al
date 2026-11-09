codeunit 80602 "CGR Lease Due Invoicing Runner"
{
    var
        DueRunAsOf: Date;
        DueRunLeases: Integer;

    trigger OnRun()
    var
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
    begin
        DueRunLeases := DueInvoicing.InvoiceDue(DueRunAsOf);
    end;

    procedure SetDueRun(AsOf: Date)
    begin
        DueRunAsOf := AsOf;
    end;

    procedure LeasesInvoicedInDueRun(): Integer
    begin
        exit(DueRunLeases);
    end;
}
