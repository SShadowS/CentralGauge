codeunit 70990 "CG X010 Aggregator"
{
    Access = Internal;

    procedure SumOrEmpty(): Integer
    var
        CGX010Item: Record "CG X010 Item";
    begin
        if CGX010Item.IsEmpty() then
            exit(-1);

        CGX010Item.CalcSums(Value);
        exit(CGX010Item.Value);
    end;
}