codeunit 70316 "CGR Lease Invoice Export"
{
    procedure ExportLine(InvoiceLine: Record "CGR Lease Invoice Line"): Text
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        if InvoiceLine."Invoice Date" = 0D then
            exit(InvoiceLine."Contract No." + ';' + InvoiceLine."Vehicle No." + ';' +
                ExportFormat.FormatDate(InvoiceLine."Invoice Date") + ';' + ExportFormat.FormatAmount(InvoiceLine.Amount));
        exit(InvoiceLine."Contract No." + ';' + InvoiceLine."Vehicle No." + ';' +
            Format(InvoiceLine."Invoice Date", 0, 9) + ';' + Format(InvoiceLine.Amount, 0, '<Precision,2:2><Standard Format,9>'));
    end;
}
