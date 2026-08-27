page 70101 "Sales Order Workspace"
{
    Caption = 'Sales Order Workspace';
    PageType = Card;
    SourceTable = "Sales Header";
    SourceTableView = where("Document Type" = const(Order));
    UsageCategory = None;
    ApplicationArea = All;

    layout
    {
        area(Content)
        {
            group(General)
            {
                Caption = 'General';

                field("No."; Rec."No.")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the number of the sales order.';
                }
                field("Sell-to Customer No."; Rec."Sell-to Customer No.")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the number of the customer.';
                }
                field("Sell-to Customer Name"; Rec."Sell-to Customer Name")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the name of the customer.';
                }
                field("Order Date"; Rec."Order Date")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the date when the order was created.';
                }
                field("Posting Date"; Rec."Posting Date")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the posting date of the order.';
                }
                field(Status; Rec.Status)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the status of the order.';
                }
            }
            group(Financial)
            {
                Caption = 'Financial';

                field(Amount; Rec.Amount)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the total amount excluding VAT.';
                }
                field("Amount Including VAT"; Rec."Amount Including VAT")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the total amount including VAT.';
                }
            }
            part(Lines; "Sales Order Subform")
            {
                ApplicationArea = All;
                SubPageLink = "Document Type" = field("Document Type"), "Document No." = field("No.");
                UpdatePropagation = Both;
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(CalculateTotals)
            {
                Caption = 'Calculate Totals';
                ApplicationArea = All;
                Promoted = true;
                PromotedCategory = Process;
                PromotedIsBig = true;
                Image = Calculate;
                Enabled = ModifyActionsEnabled;
                ToolTip = 'Calculate the totals for this sales order.';

                trigger OnAction()
                begin
                    Rec.CalcFields(Amount, "Amount Including VAT");
                    Message(TotalsCalculatedMsg, Rec.Amount, Rec."Amount Including VAT");
                end;
            }
            action(ApplyDiscount)
            {
                Caption = 'Apply Discount';
                ApplicationArea = All;
                Promoted = true;
                PromotedCategory = Process;
                PromotedIsBig = true;
                Image = Discount;
                Enabled = ModifyActionsEnabled;
                ToolTip = 'Apply a 10% discount to all lines on this sales order.';

                trigger OnAction()
                var
                    SalesLine: Record "Sales Line";
                begin
                    if not Confirm(ApplyDiscountQst, false) then
                        exit;

                    SalesLine.SetRange("Document Type", Rec."Document Type");
                    SalesLine.SetRange("Document No.", Rec."No.");
                    SalesLine.SetFilter(Type, '<>%1', SalesLine.Type::" ");
                    if SalesLine.FindSet() then
                        repeat
                            SalesLine.Validate("Line Discount %", 10);
                            SalesLine.Modify(true);
                        until SalesLine.Next() = 0;

                    CurrPage.Update(false);
                    Message(DiscountAppliedMsg);
                end;
            }
            action(ExportPDF)
            {
                Caption = 'Export to PDF';
                ApplicationArea = All;
                Promoted = true;
                PromotedCategory = Process;
                Image = Export;
                ToolTip = 'Export this sales order to a PDF file.';

                trigger OnAction()
                begin
                    Message(ExportPdfMsg, Rec."No.");
                end;
            }
            action(SendEmail)
            {
                Caption = 'Send Email';
                ApplicationArea = All;
                Promoted = true;
                PromotedCategory = Process;
                Image = Email;
                ToolTip = 'Send this sales order by email.';

                trigger OnAction()
                begin
                    Message(SendEmailMsg, Rec."No.", Rec."Sell-to Customer Name");
                end;
            }
        }
    }

    var
        ModifyActionsEnabled: Boolean;
        TotalsCalculatedMsg: Label 'Totals calculated.\Amount: %1\Amount Including VAT: %2', Comment = '%1 = Amount, %2 = Amount Including VAT';
        ApplyDiscountQst: Label 'Do you want to apply a 10% discount to all lines on this order?';
        DiscountAppliedMsg: Label 'A 10% discount has been applied to all lines.';
        ExportPdfMsg: Label 'A PDF would be generated for sales order %1.', Comment = '%1 = Order No.';
        SendEmailMsg: Label 'An email with sales order %1 would be sent to %2.', Comment = '%1 = Order No., %2 = Customer Name';

    trigger OnAfterGetCurrRecord()
    begin
        ModifyActionsEnabled := Rec.Status <> Rec.Status::Released;
    end;
}