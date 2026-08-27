codeunit 70013 "CG Loop Utilities"
{
    procedure SumPositiveNumbers(Numbers: List of [Decimal]): Decimal
    var
        Number: Decimal;
        Sum: Decimal;
    begin
        Sum := 0;
        foreach Number in Numbers do begin
            if Number <= 0 then
                continue;
            Sum += Number;
        end;
        exit(Sum);
    end;

    procedure CountValidCodes(Codes: List of [Code[20]]): Integer
    var
        CodeValue: Code[20];
        ValidCount: Integer;
    begin
        ValidCount := 0;
        foreach CodeValue in Codes do begin
            if CodeValue = '' then
                continue;
            ValidCount += 1;
        end;
        exit(ValidCount);
    end;

    procedure FilterAndProcess(Values: array[10] of Integer; Threshold: Integer): Text
    var
        Result: Text;
        i: Integer;
    begin
        Result := '';
        for i := 1 to 10 do begin
            if Values[i] <= Threshold then
                continue;
            if Result <> '' then
                Result += ',';
            Result += Format(Values[i]);
        end;
        exit(Result);
    end;
}