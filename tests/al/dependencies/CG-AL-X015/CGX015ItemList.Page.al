page 69751 "CG X015 Item List"
{
    Caption = 'CG X015 Item List';
    PageType = List;
    SourceTable = "CG X015 Item";
    ApplicationArea = All;
    UsageCategory = Administration;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field("Code"; Rec."Code")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the code.';
                }
                field("Description"; Rec."Description")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the description.';
                }
            }
        }
    }
}
