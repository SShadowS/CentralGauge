codeunit 70313 "CGR Lease Invoice Run"
{
    TableNo = "CGR Lease Contract";

    var
        InvoiceUpToDate: Date;
        InvoicedLines: Integer;

    trigger OnRun()
    begin
        InvoiceLease(Rec."No.");
    end;

    procedure SetUpToDate(UpToDate: Date)
    begin
        InvoiceUpToDate := UpToDate;
    end;

    procedure InvoicedLineCount(): Integer
    begin
        exit(InvoicedLines);
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure InvoiceLease(ContractNo: Code[20])
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InvoicedLines := LeaseInvoicing.InvoiceDueLines(ContractNo, InvoiceUpToDate);
    end;
}
