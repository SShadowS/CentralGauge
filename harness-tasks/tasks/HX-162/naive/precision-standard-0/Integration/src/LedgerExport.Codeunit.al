codeunit 70483 "CGR Ledger Export"
{
    procedure BuildLine(EntryNo: Integer): Text
    var
        Entry: Record "CGR Rental Ledger Entry";
        Line: TextBuilder;
    begin
        Entry.Get(EntryNo);
        Line.Append(Entry."Contract No.");
        Line.Append(';');
        Line.Append(Entry."Vehicle No.");
        Line.Append(';');
        Line.Append(Format(Entry."Posting Date", 0, 9));
        Line.Append(';');
        Line.Append(Format(Round(Entry.Amount, 0.01), 0, '<Precision,2:2><Standard Format,0>'));
        Line.Append(';');
        Line.Append(Format(Entry."Km Driven", 0, 9));
        exit(Line.ToText());
    end;

    procedure BuildFile(var Entry: Record "CGR Rental Ledger Entry"): Text
    var
        FileText: TextBuilder;
    begin
        if Entry.FindSet() then
            repeat
                FileText.AppendLine(BuildLine(Entry."Entry No."));
            until Entry.Next() = 0;
        exit(FileText.ToText());
    end;
}
