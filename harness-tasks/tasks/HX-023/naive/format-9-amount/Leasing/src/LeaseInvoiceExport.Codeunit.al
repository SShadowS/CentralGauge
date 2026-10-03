codeunit 70316 "CGR Lease Invoice Export"
{
    procedure ExportLine(InvoiceLine: Record "CGR Lease Invoice Line"): Text
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        exit(InvoiceLine."Contract No." + ';' + InvoiceLine."Vehicle No." + ';' +
            ExportFormat.FormatDate(InvoiceLine."Invoice Date") + ';' + ExportFormat.FormatAmount(InvoiceLine.Amount));
    end;
}
