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
        CheckReturned(Rec);
        OnBeforePostRentalContract(Rec);
        Amount := Pricing.CalcAmount(Rec);
        PostLedger.InsertEntry(Rec, Amount);
        Rec.Status := Rec.Status::Posted;
        Rec.Modify(true);
        OnAfterPostRentalContract(Rec, Amount);
    end;

    procedure PreviewLedgerEntry(Contract: Record "CGR Rental Contract"; var Entry: Record "CGR Rental Ledger Entry")
    var
        Pricing: Codeunit "CGR Rental Pricing";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
    begin
        CheckReturned(Contract);
        PostLedger.BuildEntry(Contract, Pricing.CalcAmount(Contract), Entry);
    end;

    local procedure CheckReturned(Contract: Record "CGR Rental Contract")
    begin
        if Contract.Status <> Contract.Status::Returned then
            Error(NotReturnedErr, Contract."No.");
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
