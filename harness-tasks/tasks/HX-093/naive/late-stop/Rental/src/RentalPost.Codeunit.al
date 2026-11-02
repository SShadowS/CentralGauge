codeunit 70204 "CGR Rental-Post"
{
    TableNo = "CGR Rental Contract";

    var
        NotReturnedErr: Label 'Rental contract %1 must be returned before it is posted.', Comment = '%1 = contract number';

    trigger OnRun()
    var
        Pricing: Codeunit "CGR Rental Pricing";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
        Amount: Decimal;
    begin
        if Rec.Status <> Rec.Status::Returned then
            Error(NotReturnedErr, Rec."No.");
        OnBeforePostRentalContract(Rec);
        Amount := Pricing.CalcAmount(Rec);
        PostLedger.InsertEntry(Rec, Amount);
        PostBalancingEntry(Rec, Amount);
        Rec.Status := Rec.Status::Posted;
        Rec.Modify(true);
        OnAfterPostRentalContract(Rec, Amount);
    end;

    local procedure PostBalancingEntry(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        MatchedPayment: Record "CGR Matched Payment";
        PaymentMethod: Record "CGR Payment Method";
        Setup: Record "CGR Setup";
        BalancingEntry: Record "CGR Balancing Entry";
    begin
        if not MatchedPayment.Get(Contract."No.") then
            exit;
        if MatchedPayment."Externally Settled" then
            exit;
        if not Setup.Get() then
            Setup.Init();
        if Setup."Post Payments on Import" then
            exit;
        PaymentMethod.Get(MatchedPayment."Payment Method Code");
        if PaymentMethod."Posts to Customer Account" then
            exit;
        PaymentMethod.TestField("Balancing Account No.");
        BalancingEntry.Init();
        BalancingEntry."Contract No." := Contract."No.";
        BalancingEntry."Account No." := PaymentMethod."Balancing Account No.";
        BalancingEntry.Amount := -Amount;
        BalancingEntry.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforePostRentalContract(var RentalContract: Record "CGR Rental Contract")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPostRentalContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
    end;
}
