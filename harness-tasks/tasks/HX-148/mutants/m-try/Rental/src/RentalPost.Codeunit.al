codeunit 70204 "CGR Rental-Post"
{
    TableNo = "CGR Rental Contract";

    var
        NotReturnedErr: Label 'Rental contract %1 must be returned before it is posted.', Comment = '%1 = contract number';

    trigger OnRun()
    begin
        PostInPlace(Rec);
    end;

    procedure PostInPlace(var Contract: Record "CGR Rental Contract")
    var
        Pricing: Codeunit "CGR Rental Pricing";
        PostLedger: Codeunit "CGR Rental-Post Ledger";
        Amount: Decimal;
    begin
        if Contract.Status <> Contract.Status::Returned then
            Error(NotReturnedErr, Contract."No.");
        OnBeforePostRentalContract(Contract);
        Amount := Pricing.CalcAmount(Contract);
        PostLedger.InsertEntry(Contract, Amount);
        Contract.Status := Contract.Status::Posted;
        Contract.Modify(true);
        OnAfterPostRentalContract(Contract, Amount);
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
