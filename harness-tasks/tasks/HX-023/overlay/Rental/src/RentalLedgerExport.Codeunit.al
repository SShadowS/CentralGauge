codeunit 70216 "CGR Rental Ledger Export"
{
    procedure ExportEntry(Entry: Record "CGR Rental Ledger Entry"): Text
    begin
        exit(Entry."Contract No." + ';' + Entry."Vehicle No." + ';' +
            Format(Entry."Posting Date") + ';' + Format(Entry.Amount) + ';' + Format(Entry."Km Driven"));
    end;
}
