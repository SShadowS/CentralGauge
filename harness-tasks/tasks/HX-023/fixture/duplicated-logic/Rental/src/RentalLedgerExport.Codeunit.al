codeunit 70216 "CGR Rental Ledger Export"
{
    procedure ExportEntry(Entry: Record "CGR Rental Ledger Entry"): Text
    begin
        exit(Entry."Contract No." + ';' + Entry."Vehicle No." + ';' +
            Format(Entry."Posting Date", 0, 9) + ';' + Format(Entry.Amount, 0, '<Precision,2:2><Standard Format,9>') + ';' +
            Format(Entry."Km Driven"));
    end;
}
