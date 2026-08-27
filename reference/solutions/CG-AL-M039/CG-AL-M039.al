namespace CG.Demo;

using Microsoft.Sales.Customer;

page 70039 "CG TestPart Card"
{
    Caption = 'CG TestPart Card';
    PageType = Card;
    SourceTable = Customer;
    ApplicationArea = All;
    UsageCategory = None;

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
            part(ChildPart; "CG TestPart List")
            {
                ApplicationArea = All;
                SubPageLink = "No." = field("No.");
                Visible = true;
                Enabled = true;
            }
        }
    }
}

page 70040 "CG TestPart List"
{
    Caption = 'CG TestPart List';
    PageType = ListPart;
    SourceTable = Customer;
    ApplicationArea = All;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
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
    }
}