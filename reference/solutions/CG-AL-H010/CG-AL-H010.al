codeunit 70214 "CG Order Processor"
{
    Access = Public;

    procedure ProcessOrder(OrderNo: Code[20]; Amount: Decimal; var ProcessedAmount: Decimal; var IsHandled: Boolean)
    begin
        OnBeforeProcessOrder(OrderNo, Amount, ProcessedAmount, IsHandled);
        if IsHandled then
            exit;

        ProcessedAmount := Amount * 1.1;

        OnAfterProcessOrder(OrderNo, Amount, ProcessedAmount);
    end;

    procedure ValidateOrder(OrderNo: Code[20]; Amount: Decimal): Boolean
    var
        IsValid: Boolean;
        Handled: Boolean;
    begin
        OnBeforeValidateOrder(OrderNo, Amount, IsValid, Handled);
        if Handled then
            exit(IsValid);

        exit((Amount > 0) and (OrderNo <> ''));
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeProcessOrder(OrderNo: Code[20]; Amount: Decimal; var ProcessedAmount: Decimal; var IsHandled: Boolean)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterProcessOrder(OrderNo: Code[20]; OriginalAmount: Decimal; ProcessedAmount: Decimal)
    begin
    end;

    [IntegrationEvent(true, false)]
    local procedure OnBeforeValidateOrder(OrderNo: Code[20]; Amount: Decimal; var IsValid: Boolean; var Handled: Boolean)
    begin
    end;
}