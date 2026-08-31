codeunit 70392 "CG X074 Comment Mgt."
{
    procedure CountRelatedComments(var CommentLineRec: Record "CG X074 Comment Line"; var CommentCount: Integer)
    var
        OtherCommentLine: Record "CG X074 Comment Line";
        ReportNo: Code[20];
    begin
        ReportNo := CommentLineRec."Expense Report No.";

        if ReportNo = '' then begin
            CommentCount := 0;
            exit;
        end;

        OtherCommentLine.SetRange("Expense Report No.", ReportNo);
        CommentCount := OtherCommentLine.Count();
    end;

    procedure AddComment(ExpenseReportNo: Code[20]; CommentText: Text[250])
    var
        CommentLine: Record "CG X074 Comment Line";
        NextLineNo: Integer;
    begin
        CommentLine.SetRange("Expense Report No.", ExpenseReportNo);
        if CommentLine.FindLast() then
            NextLineNo := CommentLine."Line No." + 10000
        else
            NextLineNo := 10000;

        CommentLine.Init();
        CommentLine."Expense Report No." := ExpenseReportNo;
        CommentLine."Line No." := NextLineNo;
        CommentLine."Comment Text" := CommentText;
        CommentLine."Created By" := UpperCase(CopyStr(UserId(), 1, 50));
        CommentLine."Created At" := CurrentDateTime();
        CommentLine.Insert(true);
    end;

    procedure UpdateReportSummary(var ExpenseReportRec: Record "CG X074 Report")
    var
        CommentLine: Record "CG X074 Comment Line";
    begin
        CommentLine.SetRange("Expense Report No.", ExpenseReportRec."No.");
        ExpenseReportRec."Total Comment Count" := CommentLine.Count();
        ExpenseReportRec.Modify();
    end;
}
