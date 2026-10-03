codeunit 70313 "CGR Lease Invoice Run"
{
    TableNo = "CGR Lease Contract";

    var
        InvoiceUpToDate: Date;

    trigger OnRun()
    begin
        InvoiceLease(Rec."No.");
    end;

    procedure SetUpToDate(UpToDate: Date)
    begin
        InvoiceUpToDate := UpToDate;
    end;

    local procedure InvoiceLease(ContractNo: Code[20])
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        LeaseInvoicing.InvoiceDueLines(ContractNo, InvoiceUpToDate);
    end;
}
