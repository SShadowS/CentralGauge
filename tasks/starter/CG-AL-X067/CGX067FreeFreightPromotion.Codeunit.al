codeunit 70321 "CG X067 Free Freight Promotion"
{
    // Q3 large-order incentive: waive freight once the order clears the
    // marketing-defined threshold.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure GrantFreeFreightOnLargeOrders(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        if Amount < 1000 then
            exit;

        Freight := 0;
        IsHandled := true;
    end;
}
