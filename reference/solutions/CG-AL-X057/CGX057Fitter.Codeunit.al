codeunit 71440 "CG X057 Fitter"
{
    Access = Internal;

    procedure Fit(Source: Text): Text[30]
    var
        Result: Text[30];
    begin
        // Bound against the SIZED destination, not an intermediate.
        Result := CopyStr(Source, 1, MaxStrLen(Result));
        exit(Result);
    end;
}
