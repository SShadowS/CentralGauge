codeunit 71410 "CG X052 Agent"
{
    Access = Internal;

    procedure SetTerms(No: Code[20]; OfferedRate: Integer; NewQty: Integer)
    var
        Quote: Record "CG X052 Quote";
    begin
        if not Quote.Get(No) then
            Error('Quote %1 does not exist.', No);

        Quote.Validate(Qty, NewQty);
        Quote.Validate(Rate, OfferedRate);
        Quote.Modify(true);
    end;
}