codeunit 70015 "CGR Amount Allocation"
{
    var
        NoPartsErr: Label 'An amount can only be split into at least one part.';

    procedure AllocateAmount(Total: Decimal; Parts: Integer; var Shares: List of [Decimal])
    var
        Setup: Record "CGR Setup";
        RoundingPrecision: Decimal;
        Share: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        if Parts < 1 then
            Error(NoPartsErr);
        Clear(Shares);
        if not Setup.Get() then
            Setup.Init();
        RoundingPrecision := Setup."Amount Rounding Precision";
        if RoundingPrecision <= 0 then
            RoundingPrecision := 0.01;
        Share := Round(Total / Parts, RoundingPrecision);
        for i := 1 to Parts - 1 do begin
            Shares.Add(Share);
            Allocated += Share;
        end;
        Shares.Add(Total - Allocated);
    end;
}
