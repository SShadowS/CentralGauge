codeunit 71510 "CG X064 Log Parser"
{
    procedure SumOf(Log: Text): Integer
    var
        Tok: Text;
        Value: Integer;
        Total: Integer;
    begin
        foreach Tok in Log.Split(';') do
            if Evaluate(Value, Tok) then
                Total += Value;
        exit(Total);
    end;

    procedure CountOf(Log: Text): Integer
    var
        Tok: Text;
        Value: Integer;
        N: Integer;
    begin
        foreach Tok in Log.Split(';') do
            if Evaluate(Value, Tok) then
                N += 1;
        exit(N);
    end;
}
