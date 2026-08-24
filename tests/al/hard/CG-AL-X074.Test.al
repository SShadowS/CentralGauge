codeunit 88827 "CG-AL-X074 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears both tables before seeding its own rows. Rows that
    // belong to a different document than the one under test are seeded
    // with a nonzero count/value so "untouched" and "coincidentally zero"
    // stay distinguishable.

    local procedure SeedComment(ExpenseReportNo: Code[20]; LineNo: Integer; CommentText: Text[250])
    var
        CommentLine: Record "CG X074 Comment Line";
    begin
        CommentLine.Init();
        CommentLine."Expense Report No." := ExpenseReportNo;
        CommentLine."Line No." := LineNo;
        CommentLine."Comment Text" := CommentText;
        CommentLine.Insert();
    end;

    local procedure SeedReport(No: Code[20]; InitialCommentCount: Integer)
    var
        ExpenseReport: Record "CG X074 Report";
    begin
        ExpenseReport.Init();
        ExpenseReport."No." := No;
        ExpenseReport."Total Comment Count" := InitialCommentCount;
        ExpenseReport.Insert();
    end;

    [Test]
    procedure BrandNewReportShowsNoRelatedComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        // Orphaned comment lines left behind by other users' unsaved
        // reports elsewhere in the system - none of these belong to the
        // report being opened.
        SeedComment('', 1, 'orphan one');
        SeedComment('', 2, 'orphan two');
        SeedComment('', 3, 'orphan three');

        // A real, saved report's own comments - also not the one being
        // opened, and must not be counted either.
        SeedComment('R0001', 1, 'unrelated report comment');
        SeedComment('R0001', 2, 'unrelated report comment');

        // A comments list opening for a brand-new, not-yet-saved report has
        // no report key yet.
        CommentLineRec.SetRange("Expense Report No.", '');
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(0, CommentCount, 'A brand-new report has no comments of its own yet');
    end;

    [Test]
    procedure SavedReportCountIncludesOnlyItsOwnComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        SeedComment('R0002', 1, 'r0002 comment');
        SeedComment('R0002', 2, 'r0002 comment');
        SeedComment('R0003', 1, 'r0003 comment');
        SeedComment('R0003', 2, 'r0003 comment');
        SeedComment('R0003', 3, 'r0003 comment');
        SeedComment('R0003', 4, 'r0003 comment');
        SeedComment('', 1, 'orphan');

        // Positioned on one of the report's own lines - the way a saved
        // report's comments list actually lands once it opens, rather than
        // a range with nothing found yet.
        CommentLineRec.SetRange("Expense Report No.", 'R0002');
        CommentLineRec.FindFirst();
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(2, CommentCount, 'A saved report only counts its own comments');
    end;

    [Test]
    procedure PositionedRecordWithNoActiveRangeUsesItsOwnKey()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        SeedComment('R0004', 1, 'r0004 comment');
        SeedComment('R0004', 2, 'r0004 comment');
        SeedComment('R0004', 3, 'r0004 comment');
        SeedComment('R0004', 4, 'r0004 comment');
        SeedComment('R0004', 5, 'r0004 comment');
        SeedComment('R0005', 1, 'other report comment');

        // Positioned directly on one of the report's own lines, with no
        // range ever set on the field - the way a row looks once you've
        // simply looked it up, rather than searched for it.
        CommentLineRec.Get('R0004', 1);
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(5, CommentCount, 'A positioned line must report its own report''s comment count');
    end;

    [Test]
    procedure CommentsAreAppendedWithIncreasingLineNumbers()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R0006', 'first note');
        CommentMgt.AddComment('R0006', 'second note');

        CommentLine.Get('R0006', 10000);
        Assert.AreEqual('first note', CommentLine."Comment Text", 'The first comment must be stored at the first line');

        CommentLine.Get('R0006', 20000);
        Assert.AreEqual('second note', CommentLine."Comment Text", 'The second comment must be stored at the next line');
    end;

    [Test]
    procedure ReportSummaryReflectsOnlyItsOwnCommentsAndLeavesOthersAlone()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        OtherExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        SeedReport('R0007', 0);
        SeedReport('R0008', 777);

        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');
        CommentMgt.AddComment('R0007', 'c');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(3, ExpenseReport."Total Comment Count", 'The updated report must show its own current comment count');

        OtherExpenseReport.Get('R0008');
        Assert.AreEqual(777, OtherExpenseReport."Total Comment Count", 'A different report''s stored count must not change');
    end;

    [Test]
    procedure UpdateReportSummaryExcludesAnUnrelatedReportsComments()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        SeedReport('R0007', 0);
        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');

        SeedComment('R0008', 1, 'unrelated');
        SeedComment('R0008', 2, 'unrelated');
        SeedComment('R0008', 3, 'unrelated');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(2, ExpenseReport."Total Comment Count",
          'A report''s updated comment count must reflect only its own comments, not another report''s');
    end;

    [Test]
    procedure LineNumberingDoesNotLeakAcrossReports()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R9999', 'someone else''s first note');
        CommentMgt.AddComment('R0001', 'first note for a different report');

        CommentLine.Get('R0001', 10000);
        Assert.AreEqual('first note for a different report', CommentLine."Comment Text",
          'A report''s first comment must always start at its own first line, regardless of what other reports already contain');
    end;
}
