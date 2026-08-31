codeunit 70320 "CG X067 Freight Calculator"
{
    procedure CalculateFreight(Amount: Decimal): Decimal
    var
        Freight: Decimal;
        IsHandled: Boolean;
    begin
        OnBeforeCalculateFreight(Amount, Freight, IsHandled);
        if IsHandled then
            exit(Freight);

        exit(Round(Amount * 0.1, 0.01));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCalculateFreight(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
    end;
}
