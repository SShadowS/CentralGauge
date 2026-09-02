page 70393 "CG X074 Report Comments"
{
    PageType = ListPart;
    SourceTable = "CG X074 Comment Line";
    Caption = 'Comments';
    AutoSplitKey = true;
    DelayedInsert = true;

    layout
    {
        area(content)
        {
            repeater(Lines)
            {
                field("Comment Text"; Rec."Comment Text")
                {
                    ApplicationArea = All;
                    ShowCaption = false;
                }
                field("Created By"; Rec."Created By")
                {
                    ApplicationArea = All;
                }
                field("Created At"; Rec."Created At")
                {
                    ApplicationArea = All;
                }
            }
        }
    }

    actions
    {
        area(Processing)
        {
            action(RefreshCount)
            {
                ApplicationArea = All;
                Caption = 'Refresh Count';
                Image = Refresh;
                trigger OnAction()
                var
                    CommentMgt: Codeunit "CG X074 Comment Mgt.";
                begin
                    CommentMgt.CountRelatedComments(Rec, CommentCount);
                    Message('Comments on this report: %1', CommentCount);
                end;
            }
        }
    }

    var
        CommentCount: Integer;

    trigger OnFindRecord(Which: Text): Boolean
    var
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentMgt.CountRelatedComments(Rec, CommentCount);
        exit(Rec.Find(Which));
    end;

    trigger OnAfterGetCurrRecord()
    begin
        CurrPage.Caption := StrSubstNo('Comments (%1)', CommentCount);
    end;
}
