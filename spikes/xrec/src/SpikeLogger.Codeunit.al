codeunit 90000 "CG Spike Logger"
{
    SingleInstance = true;

    var
        LogEntries: List of [Text];

    procedure Reset()
    begin
        Clear(LogEntries);
    end;

    procedure Log(Msg: Text)
    begin
        LogEntries.Add(Msg);
    end;

    procedure GetCount(): Integer
    begin
        exit(LogEntries.Count());
    end;

    procedure GetAll(): Text
    var
        Tb: TextBuilder;
        Entry: Text;
    begin
        foreach Entry in LogEntries do begin
            Tb.Append(Entry);
            Tb.Append(' | ');
        end;
        exit(Tb.ToText());
    end;
}
