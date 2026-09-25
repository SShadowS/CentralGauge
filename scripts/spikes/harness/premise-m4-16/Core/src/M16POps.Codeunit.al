// SPIKE (throwaway): harness bench M4-16 premise probe
codeunit 50202 "M16P Ops"
{
    procedure DeleteAllThenError()
    var
        Row: Record "M16P Row";
    begin
        Row.DeleteAll();
        Error('P1 raised after DeleteAll');
    end;
}
