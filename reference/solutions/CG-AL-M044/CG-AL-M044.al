codeunit 70091 "CG M044 Priority Calc"
{
    Access = Public;

    procedure NextPriority(IsEmptyView: Boolean; BelowxRec: Boolean; xRecPriority: Code[20]; LastInGroupPriority: Code[20]) Result: Code[20]
    begin
        if IsEmptyView then
            exit('1');

        if BelowxRec then
            exit(IncStr(xRecPriority));

        exit(IncStr(LastInGroupPriority));
    end;
}

page 70092 "CG M044 Item List"
{
    PageType = List;
    SourceTable = "CG M044 Item";
    SourceTableView = sorting("Group Code", "Priority");
    ApplicationArea = All;
    UsageCategory = Lists;
    Caption = 'CG M044 Item List';

    layout
    {
        area(Content)
        {
            repeater(General)
            {
                field("Entry No."; Rec."Entry No.")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the entry number.';
                }
                field("Group Code"; Rec."Group Code")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the group code.';
                }
                field(Priority; Rec."Priority")
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the priority.';
                }
                field(Description; Rec.Description)
                {
                    ApplicationArea = All;
                    ToolTip = 'Specifies the description.';
                }
            }
        }
    }

    trigger OnNewRecord(BelowxRec: Boolean)
    var
        LocalRec: Record "CG M044 Item";
        PriorityCalc: Codeunit "CG M044 Priority Calc";
        LastInGroupPriority: Code[20];
    begin
        if Rec.IsEmpty() then begin
            Rec."Priority" := PriorityCalc.NextPriority(true, BelowxRec, '', '');
            exit;
        end;

        if BelowxRec then begin
            Rec."Priority" := PriorityCalc.NextPriority(false, true, xRec."Priority", '');
            exit;
        end;

        LocalRec.Copy(Rec);
        LocalRec.SetRange("Group Code", Rec."Group Code");
        if LocalRec.FindLast() then
            LastInGroupPriority := LocalRec."Priority"
        else
            LastInGroupPriority := '';

        Rec."Priority" := PriorityCalc.NextPriority(false, false, '', LastInGroupPriority);
    end;
}