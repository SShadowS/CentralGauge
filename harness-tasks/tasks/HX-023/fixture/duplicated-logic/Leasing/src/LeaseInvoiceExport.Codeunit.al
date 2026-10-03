codeunit 70316 "CGR Lease Invoice Export"
{
    procedure ExportLine(InvoiceLine: Record "CGR Lease Invoice Line"): Text
    begin
        exit(InvoiceLine."Contract No." + ';' + InvoiceLine."Vehicle No." + ';' +
            Format(InvoiceLine."Invoice Date", 0, 9) + ';' + Format(InvoiceLine.Amount, 0, '<Precision,2:2><Standard Format,9>'));
    end;
}
