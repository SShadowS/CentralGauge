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
        Rec.Status := Rec.Status::Posted;
        Rec.Modify(true);
        OnAfterPostRentalContract(Rec, Amount);
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
