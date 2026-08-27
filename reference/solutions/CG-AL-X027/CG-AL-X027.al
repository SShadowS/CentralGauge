codeunit 71160 "CG X027 Extractor"
{
    Access = Internal;

    procedure ExtractDigits(Value: Text): Integer
    var
        Digits: Text;
        Result: Integer;
        i: Integer;
        CurrentChar: Char;
    begin
        Digits := '';
        for i := 1 to StrLen(Value) do begin
            CurrentChar := Value[i];
            if (CurrentChar >= '0') and (CurrentChar <= '9') then
                Digits += Format(CurrentChar);
        end;

        if Digits = '' then
            exit(0);

        Evaluate(Result, Digits);
        exit(Result);
    end;
}