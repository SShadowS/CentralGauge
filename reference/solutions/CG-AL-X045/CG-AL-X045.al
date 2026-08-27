codeunit 71340 "CG X045 Agent"
{
    Access = Internal;

    procedure ApplyTerms(No: Code[20]; OfferedPrice: Integer; NewQty: Integer)
    var
        CGX045Line: Record "CG X045 Line";
    begin
        CGX045Line.Get(No);
        CGX045Line.Validate(Quantity, NewQty);
        CGX045Line.Validate(Price, OfferedPrice);
        CGX045Line.Modify(true);
    end;
}