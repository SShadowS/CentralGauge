pageextension 50720 "Sample Customer Card Ext" extends "Customer Card"
{
    trigger OnAfterGetCurrRecord()
    var
        NoCreditLimitNotification: Notification;
    begin
        // A fixed Id lets this code recall the notification it sent earlier.
        NoCreditLimitNotification.Id := GetNoCreditLimitNotificationId();
        NoCreditLimitNotification.Recall();
        if Rec."Credit Limit (LCY)" = 0 then begin
            NoCreditLimitNotification.Message := NoCreditLimitMsg;
            NoCreditLimitNotification.Scope := NotificationScope::LocalScope;
            NoCreditLimitNotification.Send();
        end;
    end;

    local procedure GetNoCreditLimitNotificationId(): Guid
    begin
        exit('6f0c2b8e-4a1d-4f7e-9b3a-2d5e8c1f7a40');
    end;

    var
        NoCreditLimitMsg: Label 'This customer has no credit limit.';
}

page 50721 "Sample Credit Review"
{
    PageType = Card;
    SourceTable = Customer;
    Caption = 'Credit Review';

    layout
    {
        area(Content)
        {
            field("No."; Rec."No.")
            {
                ApplicationArea = All;
                ToolTip = 'Specifies the number of the customer.';
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(FlagForReview)
            {
                ApplicationArea = All;
                Caption = 'Flag for Review';
                ToolTip = 'Shows a reminder that this customer needs a credit review.';

                trigger OnAction()
                begin
                    if ReviewNotification.Recall() then;
                    ReviewNotification.Message := ReviewNeededMsg;
                    ReviewNotification.Scope := NotificationScope::LocalScope;
                    ReviewNotification.Send();
                end;
            }
            action(ClearReviewFlag)
            {
                ApplicationArea = All;
                Caption = 'Clear Review Flag';
                ToolTip = 'Removes the credit review reminder.';

                trigger OnAction()
                begin
                    // The same global instance that was sent carries its Id here.
                    if ReviewNotification.Recall() then;
                end;
            }
        }
    }

    trigger OnOpenPage()
    begin
        // A generated Id is fine: it is assigned once and kept with the instance.
        ReviewNotification.Id := CreateGuid();
    end;

    trigger OnClosePage()
    begin
        if ReviewNotification.Recall() then;
    end;

    var
        ReviewNotification: Notification;
        ReviewNeededMsg: Label 'This customer needs a credit review.';
}

pageextension 50722 "Sample Customer List Ext" extends "Customer List"
{
    actions
    {
        addlast(Processing)
        {
            action(SampleShowStatementReminder)
            {
                ApplicationArea = All;
                Caption = 'Show Statement Reminder';
                ToolTip = 'Shows a reminder to send statements to the selected customers.';

                trigger OnAction()
                var
                    ReminderNotification: Notification;
                begin
                    RecallStatementReminder();
                    ReminderNotification.Message := StatementReminderMsg;
                    ReminderNotification.Scope := NotificationScope::LocalScope;
                    ReminderNotification.Send();
                    // Send assigned the Id; saving it lets a later action recall it.
                    LastReminderNotificationId := ReminderNotification.Id;
                end;
            }
            action(SampleDismissStatementReminder)
            {
                ApplicationArea = All;
                Caption = 'Dismiss Statement Reminder';
                ToolTip = 'Removes the statement reminder.';

                trigger OnAction()
                begin
                    RecallStatementReminder();
                end;
            }
        }
    }

    local procedure RecallStatementReminder()
    var
        ReminderNotification: Notification;
    begin
        if IsNullGuid(LastReminderNotificationId) then
            exit;
        ReminderNotification.Id := LastReminderNotificationId;
        if ReminderNotification.Recall() then;
        Clear(LastReminderNotificationId);
    end;

    var
        LastReminderNotificationId: Guid;
        StatementReminderMsg: Label 'Remember to send statements to the selected customers.';
}
