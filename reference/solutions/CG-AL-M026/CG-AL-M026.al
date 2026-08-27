codeunit 70126 "CG Callstack Inspector"
{
    Access = Public;

    procedure GetCurrentCallstack(): Text
    begin
        exit(SessionInformation.Callstack);
    end;

    procedure GetCallstackFromNested(): Text
    begin
        exit(InnerProcedure());
    end;

    procedure GetCallstackLineCount(): Integer
    var
        Callstack: Text;
        LineCount: Integer;
        i: Integer;
        LF: Char;
    begin
        Callstack := SessionInformation.Callstack;
        if Callstack = '' then
            exit(0);

        LF := 10;
        LineCount := 1;
        for i := 1 to StrLen(Callstack) do
            if Callstack[i] = LF then
                LineCount += 1;

        exit(LineCount);
    end;

    procedure CallstackContainsProcedure(ProcedureName: Text): Boolean
    var
        Callstack: Text;
    begin
        Callstack := SessionInformation.Callstack;
        exit(Callstack.Contains(ProcedureName));
    end;

    local procedure InnerProcedure(): Text
    begin
        exit(DeepProcedure());
    end;

    local procedure DeepProcedure(): Text
    begin
        exit(SessionInformation.Callstack);
    end;
}