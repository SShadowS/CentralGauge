codeunit 70216 "CGR Rental Ledger Export"
{
    procedure ExportEntry(Entry: Record "CGR Rental Ledger Entry"): Text
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        exit(Entry."Contract No." + ';' + Entry."Vehicle No." + ';' +
            ExportFormat.FormatDate(Entry."Posting Date") + ';' + ExportFormat.FormatAmount(Entry.Amount) + ';' +
            ExportFormat.FormatAmount(Entry."Km Driven"));
    end;
}
