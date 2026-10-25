pageextension 50720 "Sample Customer Card Ext" extends "Customer Card"
{
    trigger OnAfterGetCurrRecord()
    var
        NoCreditLimitNotification: Notification;
    begin
        if Rec."Credit Limit (LCY)" = 0 then begin
            // Send assigns an Id, but this local variable is discarded and
            // the Id is not saved anywhere.
            NoCreditLimitNotification.Message := NoCreditLimitMsg;
            NoCreditLimitNotification.Scope := NotificationScope::LocalScope;
            NoCreditLimitNotification.Send();
        end else
            // A fresh local variable with no Id cannot be the notification
            // sent for the previous customer, so that warning is not withdrawn.
            NoCreditLimitNotification.Recall();
    end;

    var
        NoCreditLimitMsg: Label 'This customer has no credit limit.';
}
