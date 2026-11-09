codeunit 80617 "CGR Hourly No Loyalty Spy"
{
    EventSubscriberInstance = Manual;

    var
        NoLoyaltyRefusedNo: Code[20];
        NoLoyaltyRefusedErr: Label 'Payment refused for %1.', Comment = '%1 = contract number';

    procedure SetNoLoyaltyRefusal(ContractNo: Code[20])
    begin
        NoLoyaltyRefusedNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Bill Run", 'OnAfterBillHourly', '', false, false)]
    local procedure NoLoyaltyRefusal(Bill: Record "CGR Hourly Bill")
    begin
        if (NoLoyaltyRefusedNo <> '') and (Bill."Contract No." = NoLoyaltyRefusedNo) then
            Error(NoLoyaltyRefusedErr, Bill."Contract No.");
    end;
}
