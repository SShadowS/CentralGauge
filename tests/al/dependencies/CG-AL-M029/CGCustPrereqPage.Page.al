page 69051 "CG Cust Prereq Page"
{
    Caption = 'CG Cust Prereq Page';
    PageType = Card;
    SourceTable = "CG Cust Prereq Table";
    ApplicationArea = All;
    UsageCategory = Administration;

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
                    ToolTip = 'Specifies the primary key.';
                }
                field("Visible Field"; Rec."Visible Field")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the field that is included on the base page.';
                }
            }
        }
    }
}
