codeunit 70015 "CGR Amount Allocation"
{
    var
        NoPartsErr: Label 'An amount can only be split into at least one part.';

    procedure AllocateAmount(Total: Decimal; Parts: Integer; var Shares: List of [Decimal])
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
        Share: Decimal;
        i: Integer;
    begin
        if Parts < 1 then
            Error(NoPartsErr);
        Clear(Shares);
        Share := AmountRounding.RoundAmount(Total / Parts);
        for i := 1 to Parts do
            Shares.Add(Share);
    end;
}
