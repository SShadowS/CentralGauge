codeunit 70015 "CGR Amount Allocation"
{
    procedure AllocateAmount(Total: Decimal; Parts: Integer; var Shares: List of [Decimal])
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
        Share: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Clear(Shares);
        if Parts < 1 then
            exit;
        Share := AmountRounding.RoundAmount(Total / Parts);
        for i := 1 to Parts - 1 do begin
            Shares.Add(Share);
            Allocated += Share;
        end;
        Shares.Add(Total - Allocated);
    end;
}
