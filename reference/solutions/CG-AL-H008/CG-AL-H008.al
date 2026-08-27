codeunit 70212 "CG Safe Executor"
{
    Access = Public;

    [TryFunction]
    procedure TryDivide(Numerator: Decimal; Denominator: Decimal; var Result: Decimal)
    begin
        if Denominator = 0 then
            Error('Division by zero is not allowed.');

        Result := Numerator / Denominator;
    end;

    procedure SafeDivide(Numerator: Decimal; Denominator: Decimal; DefaultValue: Decimal): Decimal
    var
        Result: Decimal;
    begin
        if TryDivide(Numerator, Denominator, Result) then
            exit(Result);

        exit(DefaultValue);
    end;

    [TryFunction]
    procedure TryParseInteger(InputText: Text; var ParsedValue: Integer)
    begin
        if not Evaluate(ParsedValue, InputText) then
            Error('The text %1 could not be parsed as an integer.', InputText);
    end;

    procedure SafeParseInteger(InputText: Text; DefaultValue: Integer): Integer
    var
        ParsedValue: Integer;
    begin
        if TryParseInteger(InputText, ParsedValue) then
            exit(ParsedValue);

        exit(DefaultValue);
    end;

    procedure ExecuteWithFallback(PrimaryValue: Decimal; FallbackValue: Decimal; Divisor: Decimal): Decimal
    var
        Result: Decimal;
    begin
        if TryDivide(PrimaryValue, Divisor, Result) then
            exit(Result);

        if TryDivide(FallbackValue, Divisor, Result) then
            exit(Result);

        exit(0);
    end;
}