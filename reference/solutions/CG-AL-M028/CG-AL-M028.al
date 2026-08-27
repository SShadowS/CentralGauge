page 70028 "CG Customer Summary Demo"
{
    PageType = Card;
    SourceTable = Customer;
    ApplicationArea = All;
    UsageCategory = None;
    Caption = 'CG Customer Summary Demo';
    Editable = true;

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
                    ToolTip = 'Specifies the number of the customer.';
                }
                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the name of the customer.';
                }
            }
        }
        area(FactBoxes)
        {
            systempart(DefaultSummaryPart; Summary)
            {
                ApplicationArea = All;
                Visible = false;
            }
        }
    }
}

pageextension 70029 "CG Customer Card Summary Hide" extends "Customer Card"
{
    layout
    {
        modify(DefaultSummaryPart)
        {
            Visible = false;
        }
    }
}