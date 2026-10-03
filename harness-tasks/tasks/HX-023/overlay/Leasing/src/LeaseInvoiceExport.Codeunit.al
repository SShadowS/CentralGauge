codeunit 70316 "CGR Lease Invoice Export"
{
    procedure ExportLine(InvoiceLine: Record "CGR Lease Invoice Line"): Text
    begin
        exit(InvoiceLine."Contract No." + ';' + InvoiceLine."Vehicle No." + ';' +
            Format(InvoiceLine."Invoice Date") + ';' + Format(InvoiceLine.Amount));
    end;
}
