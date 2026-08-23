codeunit 70366 "CG X071 Order Cap Enforcement"
{
    // Enforces a per-customer maximum order amount at release time.
    // Hooked into the release routine via a subscriber, so codeunit
    // "CG X071 Release Mgt" never needs to change.

    var
        OrderCapExceededErr: Label 'You cannot release this order: its amount (%1) exceeds the Max Order Amount (LCY) of %2 agreed with customer %3.', Comment = '%1 - the order amount; %2 - the customer''s cap; %3 - the customer no.';

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X071 Release Mgt", 'OnBeforeReleaseOrder', '', false, false)]
    local procedure EnforceOrderCapOnBeforeReleaseOrder(var Order: Record "CG X071 Order")
    var
        Customer: Record "CG X071 Customer";
    begin
        if Order."Document Type" <> Order."Document Type"::Order then
            exit;
        if not Customer.Get(Order."Sell-to Customer No.") then
            exit;
        if Customer."Max Order Amount (LCY)" = 0 then
            exit;
        if Order.Amount > Customer."Max Order Amount (LCY)" then
            Error(OrderCapExceededErr, Order.Amount, Customer."Max Order Amount (LCY)", Customer."No.");
    end;
}
