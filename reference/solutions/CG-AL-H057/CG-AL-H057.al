page 70570 "CG H057 List"
{
    PageType = List;
    SourceTable = "CG H057 Sample";
    SourceTableTemporary = false;
    ApplicationArea = All;
    UsageCategory = Lists;
    Editable = false;
    Caption = 'CG H057 List';

    layout
    {
        area(Content)
        {
            repeater(General)
            {
                field("Code"; Rec."Code")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the code of the record.';
                }
                field(Description; Rec.Description)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the description of the record.';
                }
                field("Status Tag"; StatusTag)
                {
                    ApplicationArea = All;
                    Caption = 'Status Tag';
                    ToolTip = 'Specifies the computed status tag based on the description length.';
                    Editable = false;
                }
            }
        }
    }

    trigger OnAfterGetRecord()
    begin
        if StrLen(Rec.Description) < 20 then
            StatusTag := 'SHORT'
        else
            if StrLen(Rec.Description) < 60 then
                StatusTag := 'MEDIUM'
            else
                StatusTag := 'LONG';
    end;

    var
        StatusTag: Text;
}