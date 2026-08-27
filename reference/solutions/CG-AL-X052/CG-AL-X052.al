codeunit 71410 "CG X052 Clerk"
{
    Access = Internal;

    procedure SetTerms(No: Code[20]; OfferedRate: Integer; NewQty: Integer)
    var
        Quote: Record "CG X052 Quote";
    begin
        Quote.Get(No);

        // Set the quantity first so the table adjusts it under its packaging rule
        // and recomputes the fee from the adjusted quantity.
        Quote.Validate(Qty, NewQty);

        // Set the rate after the quantity is adjusted so the effective rate is
        // derived using the adjusted quantity the quote now carries.
        Quote.Validate(Rate, OfferedRate);

        Quote.Modify(true);
    end;
}