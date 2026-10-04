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
        Amount: Decimal;
    begin
        CheckReturned(Contract);
        if Contract."No." = '' then
            Amount := Pricing.CalcAmount(Contract)
        else
            Amount := PreviewAmount(Contract);
        PostLedger.BuildEntry(Contract, Amount, Entry);
    end;

    local procedure PreviewAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        AmountRounding: Codeunit "CGR Amount Rounding";
        Days: Integer;
        WeekendDays: Integer;
        Driven: Integer;
        Allowed: Integer;
        i: Integer;
        Total: Decimal;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        SessionContext.GetSetup(Setup);
        Days := Contract."End Date" - Contract."Start Date" + 1;
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                begin
                    Total := AmountRounding.RoundAmount(Days * Vehicle."Daily Rate");
                    for i := 0 to Days - 1 do
                        if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                            WeekendDays += 1;
                    if (WeekendDays > 0) and (Setup."Weekend Surcharge %" <> 0) then
                        Total += AmountRounding.RoundAmount(WeekendDays * (Vehicle."Daily Rate" * Setup."Weekend Surcharge %" / 100));
                end;
            Contract."Pricing Method"::"Weekend Package":
                Total := AmountRounding.RoundAmount(2 * Vehicle."Daily Rate");
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            Total += AmountRounding.RoundAmount((Driven - Allowed) * Setup."Excess Km Rate");
        exit(Total);
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
