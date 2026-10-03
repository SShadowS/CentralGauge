codeunit 70216 "CGR Rental Ledger Export"
{
    procedure ExportEntry(Entry: Record "CGR Rental Ledger Entry"): Text
    var
        ExportFormat: Codeunit "CGR Export Format";
    begin
        if Entry."Posting Date" = 0D then
            exit(Entry."Contract No." + ';' + Entry."Vehicle No." + ';' +
                ExportFormat.FormatDate(Entry."Posting Date") + ';' + ExportFormat.FormatAmount(Entry.Amount) + ';' +
                Format(Entry."Km Driven"));
        exit(Entry."Contract No." + ';' + Entry."Vehicle No." + ';' +
            Format(Entry."Posting Date", 0, 9) + ';' + Format(Entry.Amount, 0, '<Precision,2:2><Standard Format,9>') + ';' +
            Format(Entry."Km Driven"));
    end;
}
