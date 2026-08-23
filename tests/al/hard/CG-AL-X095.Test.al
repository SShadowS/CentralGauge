codeunit 89092 "CG-AL-X095 Test"
{
    Subtype = Test;
    TestPermissions = Restrictive;

    var
        Assert: Codeunit Assert;
        LibraryLowerPermissions: Codeunit "Library - Lower Permissions";

    local procedure Seed(No: Code[20]; DocDescription: Text[100]; DocAmount: Decimal)
    var
        Document: Record "CG X095 Document";
    begin
        Document.Init();
        Document."No." := No;
        Document.Description := DocDescription;
        Document.Amount := DocAmount;
        Document.Insert();
    end;

    [Test]
    procedure PostingRecordsAnAccurateArchiveEntryAndMarksTheDocumentPosted()
    var
        Document: Record "CG X095 Document";
        Archive: Record "CG X095 Doc Archive";
        Poster: Codeunit "CG X095 Doc Poster";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X095 Doc User');

        Document.DeleteAll();
        Archive.DeleteAll();
        Seed('DOC-001', 'Widget Order', 120);
        Seed('DOC-999', 'Untouched Order', 777);

        Poster.PostDocument('DOC-001');

        Archive.SetRange("Document No.", 'DOC-001');
        Assert.IsTrue(Archive.FindFirst(), 'Posting must create an archived record for the document');
        Assert.AreEqual('Widget Order', Archive.Description, 'The archived record must carry the document''s description');
        Assert.AreEqual(120, Archive.Amount, 'The archived record must carry the document''s amount');

        Document.Get('DOC-001');
        Assert.IsTrue(Document.Posted, 'A document that was successfully archived must be marked posted');

        Document.Get('DOC-999');
        Assert.IsFalse(Document.Posted, 'A document that was never posted must remain unposted');
        Assert.AreEqual('Untouched Order', Document.Description, 'Posting one document must not alter another document''s details');
    end;

    [Test]
    procedure EditingADocumentBeforePostingUpdatesItsDetails()
    var
        Document: Record "CG X095 Document";
        Poster: Codeunit "CG X095 Doc Poster";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X095 Doc User');

        Document.DeleteAll();
        Seed('DOC-020', 'Draft', 50);

        Poster.EditDescription('DOC-020', 'Finalized');

        Document.Get('DOC-020');
        Assert.AreEqual('Finalized', Document.Description, 'Editing a document must update its stored description');
        Assert.IsFalse(Document.Posted, 'Editing a document must not post it');
    end;

    [Test]
    procedure PostingTwoDocumentsProducesIndependentArchiveEntries()
    var
        Document: Record "CG X095 Document";
        Archive: Record "CG X095 Doc Archive";
        Poster: Codeunit "CG X095 Doc Poster";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X095 Doc User');

        Document.DeleteAll();
        Archive.DeleteAll();
        Seed('DOC-010', 'Alpha Order', 250);
        Seed('DOC-011', 'Beta Order', 175);

        Poster.PostDocument('DOC-010');
        Poster.PostDocument('DOC-011');

        Archive.SetRange("Document No.", 'DOC-010');
        Assert.IsTrue(Archive.FindFirst(), 'Posting must create an archived record for each document');
        Assert.AreEqual('Alpha Order', Archive.Description, 'Each archived record must carry its own document''s description');
        Assert.AreEqual(250, Archive.Amount, 'Each archived record must carry its own document''s amount');

        Archive.SetRange("Document No.", 'DOC-011');
        Assert.IsTrue(Archive.FindFirst(), 'Posting must create an archived record for each document');
        Assert.AreEqual('Beta Order', Archive.Description, 'Each archived record must carry its own document''s description');
        Assert.AreEqual(175, Archive.Amount, 'Each archived record must carry its own document''s amount');
    end;

    [Test]
    procedure AFailedArchiveAttemptDoesNotLeaveTheDocumentMarkedPosted()
    var
        Document: Record "CG X095 Document";
        Archive: Record "CG X095 Doc Archive";
        Poster: Codeunit "CG X095 Doc Poster";
    begin
        LibraryLowerPermissions.PushPermissionSetWithoutDefaults('CG X095 Doc User');

        Document.DeleteAll();
        Archive.DeleteAll();
        Seed('DOC-004', 'Gamma Order', 300);

        Archive.Init();
        Archive."Document No." := 'DOC-004';
        Archive.Description := 'Existing Entry';
        Archive.Amount := 1;
        Archive.Insert(true);
        Commit();

        asserterror Poster.PostDocument('DOC-004');

        Document.Get('DOC-004');
        Assert.IsFalse(Document.Posted, 'A document must not end up marked posted when its archive entry could not be recorded');
    end;
}
